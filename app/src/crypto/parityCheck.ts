import { setMasterSeed, deriveTokenSecrets, hexToBytes } from './nozkClient'

const MASTER_SEED_HEX =
  '2b8c5855536fdf6354d78377fc1810b8c850cea4fdecd12478f31dd0f04e6671';

/** BLS12-381 expected values (parity with Python derive_token_secrets). */
const EXPECTED = {
  tokenIndex: 0,
  nullifierIdHex: 'b833f8cee2f6edd94b3b0c17e9557789960d009231920ceec1bc0b4ca3d49ed3',
  depositId: '0xcf95a5c7bde6d3d21fe675c63510d5ea807f6293',
  r: BigInt(
    '4438821886547857734666273869716575274965072606010662594780411669229936024370'
  ),
};

export function runParityCheck(): boolean {
  console.log('Running parity check (BLS12-381)...');

  const seedBytes = hexToBytes(MASTER_SEED_HEX);
  setMasterSeed(seedBytes);

  const secrets = deriveTokenSecrets(EXPECTED.tokenIndex);

  const nidOk = secrets.nullifierIdHex === EXPECTED.nullifierIdHex;
  const depositOk = secrets.depositId.toLowerCase() === EXPECTED.depositId.toLowerCase();
  const rOk = secrets.r === EXPECTED.r;

  console.log(`  Nullifier ID:  ${nidOk ? 'OK' : 'FAIL'} Got: ${secrets.nullifierIdHex}`);
  console.log(`  Deposit ID:    ${depositOk ? 'OK' : 'FAIL'} Got: ${secrets.depositId}`);
  console.log(`  Blinding r:    ${rOk ? 'OK' : 'FAIL'} Got: ${secrets.r}`);

  if (nidOk && depositOk && rOk) {
    console.log('PARITY CHECK PASSED');
    return true;
  } else {
    console.error('PARITY CHECK FAILED');
    return false;
  }
}
