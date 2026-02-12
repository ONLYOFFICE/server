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
 * PDF Signing Core — shared PDF layer + CMS layer for all cloud signers.
 *
 * Architecture (3 layers):
 *   PDF Layer  — preparePdfForSigning(), embedCms()  (Buffer + regex, no deps)
 *   CMS Layer  — PadesCmsBuilder (asn1js + pkijs for cert parsing, RFC 5652)
 *   Cert Utils — PEM/DER parsing via native Node.js crypto (no node-forge)
 *
 * Signer contract (implemented per provider in separate files):
 *   sign(digest: Buffer): Promise<Buffer>  — signs hash of DER SignedAttributes
 *
 * Supported cert formats: .crt / .pem (PEM-encoded X.509) and raw DER buffers.
 */

const fs = require('fs');
const crypto = require('crypto');
const asn1js = require('asn1js');
const pkijs = require('pkijs');

// =============================================================================
// OID CONSTANTS
// =============================================================================

const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',

  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  sha384WithRSA: '1.2.840.113549.1.1.12',
  sha512WithRSA: '1.2.840.113549.1.1.13',

  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',

  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47'
};

const HASH_OID = {
  sha256: OID.sha256,
  sha384: OID.sha384,
  sha512: OID.sha512
};

const SIG_OID = {
  sha256: OID.sha256WithRSA,
  sha384: OID.sha384WithRSA,
  sha512: OID.sha512WithRSA
};

// =============================================================================
// CERTIFICATE UTILS
// =============================================================================

/**
 * @param {Buffer} buf - Node.js Buffer
 * @returns {ArrayBuffer} copy-free ArrayBuffer slice
 */
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * @param {string} pem - PEM-encoded certificate string
 * @returns {Buffer} DER bytes
 */
function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

/**
 * @param {string|Buffer} input - PEM string or DER buffer
 * @returns {Buffer} DER-encoded certificate bytes
 */
function parseCertificateDer(input) {
  if (Buffer.isBuffer(input) && input[0] === 0x30) {
    return input;
  }
  const pem = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  return pemToDer(pem);
}

/**
 * @param {Buffer} derBuf - DER-encoded X.509 certificate
 * @returns {pkijs.Certificate}
 */
function parsePkijsCert(derBuf) {
  const asn1 = asn1js.fromBER(toArrayBuffer(derBuf));
  if (asn1.offset === -1) {
    throw new Error('Failed to parse certificate DER');
  }
  return new pkijs.Certificate({schema: asn1.result});
}

// =============================================================================
// PDF LAYER
// =============================================================================

const BYTERANGE_PLACEHOLDER = '**********';

/**
 * Parse PDF placeholder, fix ByteRange, compute document hash.
 *
 * @param {Buffer} pdfBytes - PDF with /ByteRange and /Contents placeholders
 * @param {string} [hashAlgorithm='sha256']
 * @param {string} [pattern='**********']
 * @returns {{ pdf: Buffer, documentHash: Buffer, contentsStart: number, placeholderSize: number }}
 */
function preparePdfForSigning(pdfBytes, hashAlgorithm = 'sha256', pattern = BYTERANGE_PLACEHOLDER) {
  const pdfStr = pdfBytes.toString('latin1');

  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const phRegex = new RegExp(`\\/ByteRange\\s*\\[\\s*0\\s+${esc}\\s+${esc}\\s+${esc}\\s*\\]`);
  let brMatch = pdfStr.match(phRegex);
  const hasPlaceholder = !!brMatch;

  if (!brMatch) {
    brMatch = pdfStr.match(/\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/);
  }
  if (!brMatch) {
    throw new Error('No /ByteRange found in PDF');
  }

  const cMatch = pdfStr.match(/\/Contents\s*</);
  if (!cMatch) {
    throw new Error('No /Contents found in PDF');
  }
  const contentsStart = pdfStr.indexOf('<', cMatch.index) + 1;
  const contentsEnd = pdfStr.indexOf('>', contentsStart);
  if (contentsEnd === -1) {
    throw new Error('Malformed /Contents — missing closing >');
  }

  const byteRange = [0, contentsStart - 1, contentsEnd + 1, pdfBytes.length - contentsEnd - 1];

  let pdf = pdfBytes;
  if (hasPlaceholder) {
    let newBR = `/ByteRange [${byteRange.join(' ')}]`;
    if (newBR.length > brMatch[0].length) {
      throw new Error('ByteRange value exceeds placeholder size');
    }
    newBR = newBR.padEnd(brMatch[0].length, ' ');
    pdf = Buffer.alloc(pdfBytes.length);
    pdfBytes.copy(pdf);
    pdf.write(newBR, brMatch.index, 'latin1');
  }

  const hash = crypto.createHash(hashAlgorithm);
  hash.update(pdf.slice(byteRange[0], byteRange[0] + byteRange[1]));
  hash.update(pdf.slice(byteRange[2], byteRange[2] + byteRange[3]));

  return {
    pdf,
    documentHash: hash.digest(),
    contentsStart,
    placeholderSize: contentsEnd - contentsStart
  };
}

/**
 * Write hex-encoded CMS into /Contents placeholder.
 *
 * @param {Buffer} pdfBytes
 * @param {number} contentsStart
 * @param {number} placeholderSize
 * @param {Buffer} cmsBytes
 * @returns {Buffer}
 */
function embedCms(pdfBytes, contentsStart, placeholderSize, cmsBytes) {
  const hex = cmsBytes.toString('hex').toUpperCase();
  if (hex.length > placeholderSize) {
    throw new Error(
      `CMS too large: ${hex.length} hex chars > ${placeholderSize} placeholder. ` +
        `Need at least ${Math.ceil(hex.length / 2) + 256} bytes in /Contents.`
    );
  }
  const result = Buffer.alloc(pdfBytes.length);
  pdfBytes.copy(result);
  result.write(hex.padEnd(placeholderSize, '0'), contentsStart, 'latin1');
  return result;
}

// =============================================================================
// ASN.1 HELPERS (thin wrappers over asn1js)
// =============================================================================

/** @param {Array} children */
function asn1Seq(children) {
  return new asn1js.Sequence({value: children});
}

/** @param {number} n */
function asn1Int(n) {
  return new asn1js.Integer({value: n});
}

/** @param {Buffer} buf */
function asn1Octet(buf) {
  return new asn1js.OctetString({valueHex: new Uint8Array(buf).buffer});
}

/** @param {string} oid */
function asn1AlgId(oid) {
  return asn1Seq([new asn1js.ObjectIdentifier({value: oid}), new asn1js.Null()]);
}

/**
 * @param {string} oid
 * @param {Array} values
 */
function asn1Attr(oid, values) {
  return asn1Seq([new asn1js.ObjectIdentifier({value: oid}), new asn1js.Set({value: values})]);
}

// =============================================================================
// CMS LAYER — PAdES-B-B (asn1js + pkijs for cert parsing, RFC 5652)
// =============================================================================

/**
 * Builds CMS/PKCS#7 SignedData (PAdES-B-B) with externally-provided signature.
 *
 * Uses asn1js for ASN.1 construction, pkijs only for X.509 cert parsing.
 * No node-forge dependency.
 *
 * PAdES-B-B signed attributes:
 *   contentType, signingTime, messageDigest, signing-certificate-v2 (ESSCertIDv2)
 */
class PadesCmsBuilder {
  /**
   * @param {Buffer[]} certsDer - DER-encoded certificates [signer, ...ca]
   * @param {string} [hashAlgorithm='sha256']
   */
  constructor(certsDer, hashAlgorithm = 'sha256') {
    this.certsDer = certsDer;
    this.hashAlg = hashAlgorithm;
    this.hashOid = HASH_OID[hashAlgorithm];
    this.sigOid = SIG_OID[hashAlgorithm];

    if (!this.hashOid) {
      throw new Error(`Unsupported hash algorithm: ${hashAlgorithm}`);
    }

    // pkijs used only for issuer/serialNumber extraction
    this.signerCert = parsePkijsCert(certsDer[0]);
  }

  /**
   * Compute digest of DER-encoded SignedAttributes.
   * This hash goes to the remote signer (KMS / HSM / CSC).
   *
   * @param {Buffer} documentHash - hash of PDF byte ranges
   * @param {Date} [signingTime=new Date()]
   * @returns {Buffer} hash of DER SignedAttributes
   */
  getSignedAttributesDigest(documentHash, signingTime = new Date()) {
    // Encode as [0] IMPLICIT (identical bytes to final CMS)
    const implicitDer = this._encodeSignedAttrs(documentHash, signingTime);

    // Swap tag 0xA0 → 0x31 (SET) per RFC 5652 §5.4
    const setDer = Buffer.from(implicitDer);
    setDer[0] = 0x31;

    return crypto.createHash(this.hashAlg).update(setDer).digest();
  }

  /**
   * Build complete DER-encoded CMS SignedData.
   *
   * @param {Buffer} documentHash
   * @param {Buffer} signatureValue - raw signature from remote signer
   * @param {Date} [signingTime=new Date()]
   * @returns {Buffer} DER-encoded CMS (ContentInfo wrapping SignedData)
   */
  build(documentHash, signatureValue, signingTime = new Date()) {
    // Re-parse signed attrs DER into ASN.1 node (preserves exact bytes)
    const attrsDer = this._encodeSignedAttrs(documentHash, signingTime);
    const attrsNode = asn1js.fromBER(new Uint8Array(attrsDer).buffer).result;

    // SignerInfo SEQUENCE
    const signerInfo = asn1Seq([
      asn1Int(1),
      asn1Seq([this.signerCert.issuer.toSchema(), this.signerCert.serialNumber]),
      asn1AlgId(this.hashOid),
      attrsNode,
      asn1AlgId(this.sigOid),
      asn1Octet(signatureValue)
    ]);

    // Re-parse raw certificate DER into ASN.1 nodes
    const certNodes = this.certsDer.map(d => asn1js.fromBER(new Uint8Array(d).buffer).result);

    // SignedData SEQUENCE
    const signedData = asn1Seq([
      asn1Int(1),
      new asn1js.Set({value: [asn1AlgId(this.hashOid)]}),
      asn1Seq([new asn1js.ObjectIdentifier({value: OID.data})]),
      new asn1js.Constructed({idBlock: {tagClass: 3, tagNumber: 0}, value: certNodes}),
      new asn1js.Set({value: [signerInfo]})
    ]);

    // ContentInfo wrapper
    const contentInfo = asn1Seq([
      new asn1js.ObjectIdentifier({value: OID.signedData}),
      new asn1js.Constructed({idBlock: {tagClass: 3, tagNumber: 0}, value: [signedData]})
    ]);

    return Buffer.from(contentInfo.toBER(false));
  }

  /**
   * Encode SignedAttributes as [0] IMPLICIT (tag 0xA0).
   * Same bytes used in CMS; tag swapped to 0x31 for hashing.
   *
   * @param {Buffer} documentHash
   * @param {Date} signingTime
   * @returns {Buffer}
   * @private
   */
  _encodeSignedAttrs(documentHash, signingTime) {
    const certHash = crypto.createHash('sha256').update(this.certsDer[0]).digest();

    // ESSCertIDv2 (hashAlgorithm omitted for SHA-256 DEFAULT per RFC 5035)
    const essCertIdV2 = asn1Seq([asn1Octet(certHash)]);
    // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
    const signingCertV2 = asn1Seq([asn1Seq([essCertIdV2])]);

    const attrs = [
      asn1Attr(OID.contentType, [new asn1js.ObjectIdentifier({value: OID.data})]),
      asn1Attr(OID.signingTime, [new asn1js.UTCTime({valueDate: signingTime})]),
      asn1Attr(OID.messageDigest, [asn1Octet(documentHash)]),
      asn1Attr(OID.signingCertificateV2, [signingCertV2])
    ];

    // [0] IMPLICIT (Constructed, context-specific, tag 0)
    const implicit = new asn1js.Constructed({
      idBlock: {tagClass: 3, tagNumber: 0},
      value: attrs
    });

    return Buffer.from(implicit.toBER(false));
  }
}

// =============================================================================
// PEM CHAIN UTILITIES
// =============================================================================

/**
 * Reads a PEM bundle file and returns DER buffers for each certificate.
 * First cert = leaf, rest = intermediates.
 *
 * @param {string} pemPath - path to PEM bundle file
 * @returns {Buffer[]} DER-encoded certificate buffers
 */
function parsePemChain(pemPath) {
  const content = fs.readFileSync(pemPath, 'utf8');
  const blocks = content.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!blocks || blocks.length === 0) {
    throw new Error(`No PEM certificates found in ${pemPath}`);
  }
  return blocks.map(block => {
    const b64 = block
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s/g, '');
    return Buffer.from(b64, 'base64');
  });
}

/**
 * Detects whether a file is PEM or P12/PFX by content inspection.
 *
 * @param {string} filePath
 * @returns {'pem'|'p12'}
 */
function detectCertType(filePath) {
  const head = fs.readFileSync(filePath, {encoding: null});
  return head.toString('utf8', 0, Math.min(head.length, 100)).includes('-----BEGIN CERTIFICATE-----') ? 'pem' : 'p12';
}

/**
 * Generic PDF cloud signing orchestration.
 * Provider-agnostic: accepts a signer function that signs a digest.
 *
 * @param {string} inputPath - PDF with placeholder from x2t
 * @param {string|null} outputPath - output path (null = overwrite)
 * @param {Object} opts
 * @param {string} opts.certificateChainPath - PEM bundle path
 * @param {string} [opts.hashAlgorithm='sha256']
 * @param {(digest: Buffer) => Promise<Buffer>} signerFn - signs digest, returns raw signature
 * @returns {Promise<void>}
 */
async function signPdfWithSigner(inputPath, outputPath, opts, signerFn) {
  if (!outputPath) outputPath = inputPath;

  const hashAlgorithm = opts.hashAlgorithm || 'sha256';
  const signingTime = new Date();
  const certsDer = parsePemChain(opts.certificateChainPath);

  const pdfBytes = fs.readFileSync(inputPath);
  const {pdf, documentHash, contentsStart, placeholderSize} = preparePdfForSigning(pdfBytes, hashAlgorithm);

  const cms = new PadesCmsBuilder(certsDer, hashAlgorithm);
  const attrDigest = cms.getSignedAttributesDigest(documentHash, signingTime);

  const signatureValue = await signerFn(attrDigest);

  const cmsBytes = cms.build(documentHash, signatureValue, signingTime);
  const signedPdf = embedCms(pdf, contentsStart, placeholderSize, cmsBytes);
  fs.writeFileSync(outputPath, signedPdf);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  PadesCmsBuilder,
  preparePdfForSigning,
  embedCms,
  pemToDer,
  parseCertificateDer,
  parsePkijsCert,
  toArrayBuffer,
  parsePemChain,
  detectCertType,
  signPdfWithSigner,
  OID,
  HASH_OID,
  SIG_OID,
  BYTERANGE_PLACEHOLDER
};
