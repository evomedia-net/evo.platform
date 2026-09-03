// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutDto, MAX_CHECKOUT_QUANTITY } from './dto';

const base = {
  tenantId: 't1',
  successUrl: 'https://app.example/billing/ok',
  cancelUrl: 'https://app.example/billing/cancel',
};
const problems = (input: object) => validate(plainToInstance(CheckoutDto, { ...base, ...input }));

describe('CheckoutDto.quantity', () => {
  it('may be omitted (defaults to one at checkout)', async () => {
    expect(await problems({})).toHaveLength(0);
  });

  it('accepts an ordinary seat count', async () => {
    expect(await problems({ quantity: 25 })).toHaveLength(0);
  });

  it('refuses zero, negatives and fractions', async () => {
    for (const quantity of [0, -1, 2.5]) {
      expect(await problems({ quantity })).not.toHaveLength(0);
    }
  });

  it('is capped, so a compromised app cannot mint an absurd checkout', async () => {
    expect(await problems({ quantity: MAX_CHECKOUT_QUANTITY })).toHaveLength(0);
    expect(await problems({ quantity: MAX_CHECKOUT_QUANTITY + 1 })).not.toHaveLength(0);
  });
});
