import { meetsPasswordPolicy } from './password-policy';

describe('password policy (≥8 chars, ≥2 digits, ≥2 specials)', () => {
  it('accepts a password meeting every rule', () => {
    expect(meetsPasswordPolicy('Abcd12!@')).toBe(true);
    expect(meetsPasswordPolicy('p@ss5word#7')).toBe(true);
  });

  it('rejects too-short passwords even if they have digits/specials', () => {
    expect(meetsPasswordPolicy('a1!2@')).toBe(false); // 5 chars
  });

  it('rejects fewer than 2 digits', () => {
    expect(meetsPasswordPolicy('Password1!@')).toBe(false); // one digit
  });

  it('rejects fewer than 2 special characters', () => {
    expect(meetsPasswordPolicy('Password12!')).toBe(false); // one special
  });

  it('rejects letters-only', () => {
    expect(meetsPasswordPolicy('PasswordOnly')).toBe(false);
  });

  it('counts non-adjacent digits and specials anywhere in the string', () => {
    expect(meetsPasswordPolicy('9a!bc#de3')).toBe(true);
  });
});
