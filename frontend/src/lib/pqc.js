import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

const bytesToBase64 = (bytes) => {
  const binString = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binString);
};

const base64ToBytes = (str) => {
  const binString = atob(str);
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
};

export const generatePQCKeypair = () => {
  const kem = ml_kem768.keygen();
  const dsa = ml_dsa65.keygen();
  
  return {
    kem: {
      publicKey: bytesToBase64(kem.publicKey),
      secretKey: bytesToBase64(kem.secretKey),
    },
    dsa: {
      publicKey: bytesToBase64(dsa.publicKey),
      secretKey: bytesToBase64(dsa.secretKey),
    }
  };
};

export const pqcEncapsulate = (publicKeyBase64) => {
  const pubKey = base64ToBytes(publicKeyBase64);
  const { sharedSecret, ciphertext } = ml_kem768.encapsulate(pubKey);
  return {
    sharedSecret: sharedSecret,
    ciphertext: bytesToBase64(ciphertext),
  };
};

export const pqcDecapsulate = (ciphertextBase64, secretKeyBase64) => {
  const ct = base64ToBytes(ciphertextBase64);
  const sk = base64ToBytes(secretKeyBase64);
  return ml_kem768.decapsulate(ct, sk);
};

export const pqcSign = (messageBytes, secretKeyBase64) => {
  const sk = base64ToBytes(secretKeyBase64);
  const signature = ml_dsa65.sign(messageBytes, sk);
  return bytesToBase64(signature);
};

export const pqcVerify = (signatureBase64, messageBytes, publicKeyBase64) => {
  const sig = base64ToBytes(signatureBase64);
  const pub = base64ToBytes(publicKeyBase64);
  return ml_dsa65.verify(sig, messageBytes, pub);
};
