/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 */

'use strict';

/**
 * PDF AWS KMS Signer — PAdES-B-B signing via AWS KMS.
 *
 * Uses pdfSigningCore for PDF placeholder operations and CMS assembly.
 * Only the KMS sign() call is provider-specific.
 *
 * AWS KMS key must be asymmetric RSA (SIGN_VERIFY usage).
 * Certificate must be obtained separately from a CA (via CSR).
 *
 * Supported auth: default credential chain or explicit accessKeyId/secretAccessKey.
 * Supported certs: .crt / .pem only (no PFX/P12).
 *
 * Usage:
 *   const { signPdfFile } = require('./pdfAwsKmsSigner');
 *
 *   await signPdfFile('input.pdf', 'signed.pdf', {
 *     endpoint: 'https://kms.eu-west-1.amazonaws.com',
 *     keyId: 'arn:aws:kms:eu-west-1:123456789:key/abcd-...',
 *     certificate: fs.readFileSync('signer.crt', 'utf8'),
 *     caCertificates: [fs.readFileSync('intermediate.pem', 'utf8')],
 *   });
 */

const {signPdfWithSigner} = require('./pdfSigningCore');

// AWS KMS signing algorithms (PKCS#1 v1.5)
const KMS_ALGORITHMS = {
  sha256: 'RSASSA_PKCS1_V1_5_SHA_256',
  sha384: 'RSASSA_PKCS1_V1_5_SHA_384',
  sha512: 'RSASSA_PKCS1_V1_5_SHA_512'
};

/**
 * Signs digests using AWS KMS asymmetric RSA key.
 * Implements signer contract: sign(digest) → Buffer.
 * MessageType=DIGEST — KMS receives pre-computed hash, no double hashing.
 */
class AwsKmsSigner {
  /**
   * @param {Object} config
   * @param {string} config.keyId - KMS key ID, ARN, alias, or alias ARN
   * @param {string} [config.endpoint] - KMS endpoint URL, region name, or empty (region auto-extracted from ARN)
   * @param {string} [config.accessKeyId] - explicit credentials (otherwise default chain)
   * @param {string} [config.secretAccessKey]
   * @param {string} [config.hashAlgorithm='sha256']
   */
  constructor(config) {
    this.keyId = config.keyId;
    this.hashAlgorithm = config.hashAlgorithm || 'sha256';

    if (!KMS_ALGORITHMS[this.hashAlgorithm]) {
      throw new Error(`Unsupported hash algorithm: ${this.hashAlgorithm}`);
    }

    const kmsOpts = {};
    if (config.endpoint) {
      if (config.endpoint.startsWith('http')) {
        kmsOpts.endpoint = config.endpoint;
        const match = config.endpoint.match(/kms\.([a-z0-9-]+)\.amazonaws/);
        if (match) kmsOpts.region = match[1];
      } else {
        kmsOpts.region = config.endpoint;
      }
    }
    if (!kmsOpts.region && config.keyId) {
      const arnMatch = config.keyId.match(/^arn:aws:kms:([a-z0-9-]+):/);
      if (arnMatch) kmsOpts.region = arnMatch[1];
    }
    if (config.accessKeyId && config.secretAccessKey) {
      kmsOpts.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      };
    }

    const {KMSClient} = require('@aws-sdk/client-kms');
    this.kmsClient = new KMSClient(kmsOpts);
  }

  /**
   * @param {Buffer} digest - pre-computed hash of DER SignedAttributes
   * @returns {Promise<Buffer>} raw signature bytes
   */
  async sign(digest) {
    const {SignCommand} = require('@aws-sdk/client-kms');
    const resp = await this.kmsClient.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: digest,
        MessageType: 'DIGEST',
        SigningAlgorithm: KMS_ALGORITHMS[this.hashAlgorithm]
      })
    );
    return Buffer.from(resp.Signature);
  }
}

/**
 * Sign a PDF file using AWS KMS.
 *
 * @param {string} inputPath - PDF with placeholder from x2t
 * @param {string|null} outputPath - output path (null = overwrite)
 * @param {Object} config
 * @param {string} config.keyId
 * @param {string} config.certificateChainPath - PEM bundle path
 * @param {string} [config.hashAlgorithm='sha256']
 * @param {string} [config.endpoint] - KMS endpoint URL, region name, or empty
 * @param {string} [config.accessKeyId]
 * @param {string} [config.secretAccessKey]
 * @returns {Promise<void>}
 */
async function signPdfFile(inputPath, outputPath, config) {
  const signer = new AwsKmsSigner(config);
  return signPdfWithSigner(inputPath, outputPath, config, digest => signer.sign(digest));
}

module.exports = {
  AwsKmsSigner,
  signPdfFile,
  KMS_ALGORITHMS
};
