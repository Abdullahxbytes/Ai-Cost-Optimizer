import bcrypt from 'bcrypt';

describe('password hashing', () => {
  it('hashes the same password differently each time because salts are unique', async () => {
    const [first, second] = await Promise.all([bcrypt.hash('CorrectPassword9!', 12), bcrypt.hash('CorrectPassword9!', 12)]);
    expect(first).not.toBe(second);
  });
  it('verifies a correct password', async () => expect(await bcrypt.compare('CorrectPassword9!', await bcrypt.hash('CorrectPassword9!', 12))).toBe(true));
  it('rejects an incorrect password', async () => expect(await bcrypt.compare('WrongPassword9!', await bcrypt.hash('CorrectPassword9!', 12))).toBe(false));
});
