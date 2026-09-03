// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupLinkDto } from './dto';

const problems = (input: object) => validate(plainToInstance(SignupLinkDto, input));

describe('SignupLinkDto.expiresInHours', () => {
  it('may be omitted; the controller then defaults to 72', async () => {
    expect(await problems({})).toHaveLength(0);
  });

  it('accepts a sensible number of hours', async () => {
    expect(await problems({ expiresInHours: 48 })).toHaveLength(0);
  });

  it('rejects a string, which used to become NaN', async () => {
    expect(await problems({ expiresInHours: 'soon' })).not.toHaveLength(0);
  });

  it('rejects zero and negatives', async () => {
    expect(await problems({ expiresInHours: 0 })).not.toHaveLength(0);
    expect(await problems({ expiresInHours: -5 })).not.toHaveLength(0);
  });

  it('caps at 30 days, which used to be unbounded', async () => {
    expect(await problems({ expiresInHours: 720 })).toHaveLength(0);
    expect(await problems({ expiresInHours: 721 })).not.toHaveLength(0);
    expect(await problems({ expiresInHours: 100000 })).not.toHaveLength(0);
  });
});
