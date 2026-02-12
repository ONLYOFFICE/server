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

const {describe, test, expect, beforeAll} = require('@jest/globals');
const crypto = require('crypto');
const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  PadesCmsBuilder,
  preparePdfForSigning,
  embedCms,
  pemToDer,
  parseCertificateDer,
  OID
} = require('../../FileConverter/sources/signing/pdfSigningCore');

// Generate a self-signed cert once for all tests
let testCertPem;
let testKeyPem;
let testCertDer;

beforeAll(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-sign-test-'));
  const keyPath = path.join(tmpDir, 'key.pem');
  const certPath = path.join(tmpDir, 'cert.pem');

  execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=Test/O=TestOrg"`, {stdio: 'pipe'});

  testCertPem = fs.readFileSync(certPath, 'utf8');
  testKeyPem = fs.readFileSync(keyPath, 'utf8');
  testCertDer = pemToDer(testCertPem);

  // Cleanup
  fs.unlinkSync(keyPath);
  fs.unlinkSync(certPath);
  fs.rmdirSync(tmpDir);
});

// Minimal PDF with /ByteRange placeholder and /Contents placeholder
function createTestPdf() {
  const placeholder = '0'.repeat(8192);
  const content =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ' +
    `/ByteRange [0 ********** ********** **********] ` +
    `/Contents <${placeholder}> >>\nendobj\n` +
    'xref\n0 4\n' +
    '%%EOF\n';
  return Buffer.from(content, 'latin1');
}

describe('Certificate Utils', () => {
  test('pemToDer converts PEM to DER', () => {
    const der = pemToDer(testCertPem);
    expect(Buffer.isBuffer(der)).toBe(true);
    expect(der[0]).toBe(0x30); // SEQUENCE tag
    expect(der.length).toBeGreaterThan(500);
  });

  test('parseCertificateDer accepts PEM string', () => {
    const der = parseCertificateDer(testCertPem);
    expect(der[0]).toBe(0x30);
  });

  test('parseCertificateDer passes through DER buffer', () => {
    const der = parseCertificateDer(testCertDer);
    expect(der).toBe(testCertDer); // same reference
  });

  test('parseCertificateDer accepts Buffer containing PEM', () => {
    const pemBuf = Buffer.from(testCertPem, 'utf8');
    const der = parseCertificateDer(pemBuf);
    expect(der[0]).toBe(0x30);
  });
});

describe('PDF Layer', () => {
  test('preparePdfForSigning resolves ByteRange and computes hash', () => {
    const pdfBytes = createTestPdf();
    const result = preparePdfForSigning(pdfBytes);

    expect(result.pdf).toBeInstanceOf(Buffer);
    expect(result.documentHash).toBeInstanceOf(Buffer);
    expect(result.documentHash.length).toBe(32); // SHA-256
    expect(result.contentsStart).toBeGreaterThan(0);
    expect(result.placeholderSize).toBe(8192);

    // ByteRange should have been resolved (no more placeholders)
    const pdfStr = result.pdf.toString('latin1');
    expect(pdfStr).not.toContain('**********');
    expect(pdfStr).toMatch(/\/ByteRange \[\d+ \d+ \d+ \d+\]/);
  });

  test('preparePdfForSigning throws on missing ByteRange', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n');
    expect(() => preparePdfForSigning(pdf)).toThrow('No /ByteRange found');
  });

  test('embedCms writes hex into Contents placeholder', () => {
    const pdfBytes = createTestPdf();
    const {pdf, contentsStart, placeholderSize} = preparePdfForSigning(pdfBytes);
    const fakeCms = Buffer.from('DEADBEEF', 'hex');

    const result = embedCms(pdf, contentsStart, placeholderSize, fakeCms);
    const hex = result.toString('latin1', contentsStart, contentsStart + 8);
    expect(hex).toBe('DEADBEEF');
  });

  test('embedCms throws when CMS is too large', () => {
    const pdfBytes = createTestPdf();
    const {pdf, contentsStart, placeholderSize} = preparePdfForSigning(pdfBytes);
    const hugeCms = Buffer.alloc(placeholderSize); // too large (hex = 2x size)

    expect(() => embedCms(pdf, contentsStart, placeholderSize, hugeCms)).toThrow('CMS too large');
  });
});

describe('PadesCmsBuilder', () => {
  test('constructor parses certificate', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    expect(cms.signerCert).toBeDefined();
    expect(cms.hashAlg).toBe('sha256');
  });

  test('constructor rejects unsupported hash algorithm', () => {
    expect(() => new PadesCmsBuilder([testCertDer], 'md5')).toThrow('Unsupported hash');
  });

  test('getSignedAttributesDigest returns 32-byte SHA-256 hash', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    const docHash = crypto.createHash('sha256').update('test-doc').digest();
    const digest = cms.getSignedAttributesDigest(docHash);

    expect(digest).toBeInstanceOf(Buffer);
    expect(digest.length).toBe(32);
  });

  test('getSignedAttributesDigest is deterministic for same inputs', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    const docHash = crypto.createHash('sha256').update('test').digest();
    const time = new Date('2025-01-01T00:00:00Z');

    const d1 = cms.getSignedAttributesDigest(docHash, time);
    const d2 = cms.getSignedAttributesDigest(docHash, time);
    expect(d1.equals(d2)).toBe(true);
  });

  test('build produces valid CMS ContentInfo DER', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    const docHash = crypto.createHash('sha256').update('test').digest();
    const signingTime = new Date();
    const attrDigest = cms.getSignedAttributesDigest(docHash, signingTime);

    // Sign with local key
    const sig = crypto.sign('SHA256', attrDigest, {
      key: testKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    });

    const cmsBytes = cms.build(docHash, sig, signingTime);
    expect(cmsBytes).toBeInstanceOf(Buffer);

    // ContentInfo: SEQUENCE { OID(signedData), [0] { SignedData } }
    expect(cmsBytes[0]).toBe(0x30); // outer SEQUENCE
    expect(cmsBytes.length).toBeGreaterThan(1000);

    // Verify OID signedData (1.2.840.113549.1.7.2) is present
    const oidHex = '2a864886f70d010702';
    expect(cmsBytes.toString('hex')).toContain(oidHex);
  });

  test('build CMS contains certificate', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    const docHash = crypto.createHash('sha256').update('test').digest();
    const signingTime = new Date();
    const attrDigest = cms.getSignedAttributesDigest(docHash, signingTime);
    const sig = crypto.sign('SHA256', attrDigest, {
      key: testKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    });
    const cmsBytes = cms.build(docHash, sig, signingTime);

    // The CMS should contain the certificate DER bytes
    const certHex = testCertDer.toString('hex');
    expect(cmsBytes.toString('hex')).toContain(certHex);
  });

  test('build CMS contains signatureValue', () => {
    const cms = new PadesCmsBuilder([testCertDer]);
    const docHash = crypto.createHash('sha256').update('test').digest();
    const signingTime = new Date();
    const attrDigest = cms.getSignedAttributesDigest(docHash, signingTime);
    const sig = crypto.sign('SHA256', attrDigest, {
      key: testKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    });
    const cmsBytes = cms.build(docHash, sig, signingTime);

    // Signature (256 bytes for RSA-2048) should be present
    expect(sig.length).toBe(256);
    expect(cmsBytes.toString('hex')).toContain(sig.toString('hex'));
  });

  test('full sign pipeline: prepare → CMS → embed', () => {
    const pdfBytes = createTestPdf();
    const {pdf, documentHash, contentsStart, placeholderSize} = preparePdfForSigning(pdfBytes);

    const cms = new PadesCmsBuilder([testCertDer]);
    const signingTime = new Date();
    const attrDigest = cms.getSignedAttributesDigest(documentHash, signingTime);

    const sig = crypto.sign('SHA256', attrDigest, {
      key: testKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    });

    const cmsBytes = cms.build(documentHash, sig, signingTime);
    const signedPdf = embedCms(pdf, contentsStart, placeholderSize, cmsBytes);

    expect(signedPdf).toBeInstanceOf(Buffer);
    expect(signedPdf.length).toBe(pdf.length);

    // Verify CMS hex is in the PDF
    const cmsHex = cmsBytes.toString('hex').toUpperCase();
    expect(signedPdf.toString('latin1')).toContain(cmsHex);
  });
});

describe('OID Constants', () => {
  test('all required OIDs are defined', () => {
    expect(OID.sha256).toBe('2.16.840.1.101.3.4.2.1');
    expect(OID.signedData).toBe('1.2.840.113549.1.7.2');
    expect(OID.contentType).toBe('1.2.840.113549.1.9.3');
    expect(OID.messageDigest).toBe('1.2.840.113549.1.9.4');
    expect(OID.signingTime).toBe('1.2.840.113549.1.9.5');
    expect(OID.signingCertificateV2).toBe('1.2.840.113549.1.9.16.2.47');
  });
});
