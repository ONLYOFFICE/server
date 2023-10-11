const { describe, it, expect } = require('@jest/globals');
const fs = require('fs');
const { getDocumentFormatByByte } = require('../../Common/sources/formatchecker');
const constants = require('../../Common/sources/constants');

const docFile = '../tests/integration/files/Amchitka.doc';
const xlsFile = '../tests/integration/files/ds9.2.2-endothelial-cell-adherence.xls';
const pptFile = '../tests/integration/files/file_example_PPT_250kB.ppt';
const cryptoFile = '../tests/integration/files/MS_OFFCRYPTO.docx';
const pdfFile = '../tests/integration/files/file-sample_150kB.pdf';
const xpsFile = '../tests/integration/files/example.xps';
const htmlFile =  '../tests/integration/files/example.html';
const djvuFile = '../tests/integration/files/sample2.djvu';
const odtFile = '../tests/integration/files/file-sample_100kB.odt';

describe('getDocumentFormatByByte', () => {
	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC for DOC files', () => {
		const docBuffer = fs.readFileSync(docFile);
		const format = getDocumentFormatByByte(docBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS for XLS files', () => {
		const xlsBuffer = fs.readFileSync(xlsFile);
		const format = getDocumentFormatByByte(xlsBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT for PPT files', () => {
		const pptBuffer = fs.readFileSync(pptFile);
		const format = getDocumentFormatByByte(pptBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO for Office Crypto crypto files', () => {
		const cryptoBuffer = fs.readFileSync(cryptoFile);
		const format = getDocumentFormatByByte(cryptoBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF for PDF files', () => {
		const pdfBuffer = fs.readFileSync(pdfFile);
		const format = getDocumentFormatByByte(pdfBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS for XPS files', () => {
		const xpsBuffer = fs.readFileSync(xpsFile);
		const format = getDocumentFormatByByte(xpsBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML for HTML files', () => {
		const htmlBuffer = fs.readFileSync(htmlFile);
		const format = getDocumentFormatByByte(htmlBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU for DJVU files', () => {
		const djvuBuffer = fs.readFileSync(djvuFile);
		const format = getDocumentFormatByByte(djvuBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT for ODT files', () => {
		const odtBuffer = fs.readFileSync(odtFile);
		const format = getDocumentFormatByByte(odtBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT);
	});
});
