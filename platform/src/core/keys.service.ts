// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, createPublicKey, generateKeyPairSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Owns the platform's RSA signing keypair. Apps never call the platform to
 * verify tokens — they fetch the JWKS once, cache it, and verify locally.
 */
@Injectable()
export class KeysService implements OnModuleInit {
  private privatePem!: string;
  private publicPem!: string;
  kid!: string;

  onModuleInit() {
    this.loadOrGenerate();
  }

  loadOrGenerate(dir: string = config.keysDir) {
    const privPath = join(dir, 'private.pem');
    const pubPath = join(dir, 'public.pem');
    if (existsSync(privPath) && existsSync(pubPath)) {
      this.privatePem = readFileSync(privPath, 'utf8');
      this.publicPem = readFileSync(pubPath, 'utf8');
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      this.privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      this.publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      mkdirSync(dir, { recursive: true });
      writeFileSync(privPath, this.privatePem);
      writeFileSync(pubPath, this.publicPem);
    }
    // RFC 7638-style thumbprint over the canonical JWK members
    const jwk = createPublicKey(this.publicPem).export({ format: 'jwk' }) as {
      kty: string;
      n: string;
      e: string;
    };
    this.kid = createHash('sha256')
      .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
      .digest('base64url')
      .slice(0, 16);
  }

  sign(claims: object, ttlSec: number = config.accessTtlSec): string {
    return jwt.sign(claims, this.privatePem, {
      algorithm: 'RS256',
      keyid: this.kid,
      expiresIn: ttlSec,
      issuer: config.jwtIssuer,
    });
  }

  verify<T = Record<string, unknown>>(token: string): T {
    return jwt.verify(token, this.publicPem, {
      algorithms: ['RS256'],
      issuer: config.jwtIssuer,
    }) as T;
  }

  jwks() {
    const jwk = createPublicKey(this.publicPem).export({ format: 'jwk' });
    return { keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: this.kid }] };
  }
}
