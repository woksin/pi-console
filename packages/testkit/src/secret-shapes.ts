/**
 * Synthetic secrets in the shapes the redactor must catch. None is a real credential. Values are assembled from
 * fragments so this file contains no complete token literal (repository secret scanners stay quiet) and so specs
 * can prove a shape never reaches the event log or the API.
 */
export interface SecretShape {
  name: string;
  /** The full text as it would appear in a source file. */
  value: string;
  /** The part that must never survive redaction; a literal substring of `value`. */
  needle: string;
}

const shape = (name: string, parts: string[], needleStart: number, needleLength: number): SecretShape => {
  const value = parts.join('');
  return { name, value, needle: value.slice(needleStart, needleStart + needleLength) };
};

export const secretShapes: readonly SecretShape[] = [
  shape('aws-access-key-id', ['AKIA', 'IOSFODNN7', 'EXAMPLE'], 0, 20),
  shape('aws-secret-access-key', ['aws_secret_access_key', '=', 'wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYEXAMPLEKEY'], 22, 40),
  shape('github-token', ['ghp', '_', '0123456789abcdefghij', 'klmnopqrstuvwxyzABCD'], 0, 44),
  shape('slack-token', ['xox', 'b-', '123456789012-', 'abcdefghijklmnopqrstuvwx'], 0, 40),
  shape('bearer-token', ['Authorization: Bearer ', 'q7Zk3vN9xT2mW8pL5dR1', 'sY6uH4jB0cE'], 22, 31),
  shape('private-key-block', ['-----BEGIN ', 'RSA PRIVATE KEY-----', '\nMIIEowIBAAKCAQEAsyntheticsyntheticsynthetic\n', '-----END ', 'RSA PRIVATE KEY-----'], 31, 42),
  shape('dotenv-line', ['DATABASE_', 'PASSWORD=', 'hunter2-syn', 'thetic-value'], 18, 23),
  shape('jwt', ['eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJzeW50aGV0aWMifQ', '.', 'c2lnbmF0dXJlLXN5bnRoZXRpYw'], 0, 76),
  shape('google-api-key', ['AIza', 'SyA1B2C3D4E5F6G7H8I9J0K', 'LmNoPqRsTuV'], 0, 39),
  shape('azure-storage-key', ['AccountKey', '=', 'c3ludGhldGljc3ludGhldGljc3ludGhldGljc3ludGhldGljc3ludGhldGljc3ludGhldGljMQ', '=='], 11, 78),
  shape('connection-string', ['postgres://', 'app_user:', 'synthetic-', 'pass-9f3k', '@db.invalid:5432/app'], 20, 19),
];

/** Names of the shapes whose secret part occurs in `text`. Empty means the text is clean. */
export function secretsIn(text: string): string[] {
  return secretShapes.filter(secret => text.includes(secret.needle)).map(secret => secret.name);
}
