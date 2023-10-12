const { describe, it, expect } = require('@jest/globals');
const fs = require('fs');
const { getDocumentFormatByByte } = require('../../Common/sources/formatchecker');
const constants = require('../../Common/sources/constants');

const docFile = '../tests/integration/files/Amchitka.doc';
const xlsFile = '../tests/integration/files/ds9.2.2-endothelial-cell-adherence.xls';
const pptFile = '../tests/integration/files/file_example_PPT_250kB.ppt';
const cryptoFile = '../tests/integration/files/MS_OFFCRYPTO.docx';

// OXX file
const docxFile = '../tests/integration/files/file-sample_100kB.docx';
const dotxFile = '../tests/integration/files/example.dotx';
const docmFile = '../tests/integration/files/example.docm';
const dotmFile = '../tests/integration/files/11111111111111.dotm';
const oforFile = '../tests/integration/files/new.oform';
const docxfFile = '../tests/integration/files/new.docxf';

const xlsxFile = '../tests/integration/files/file_example_XLSX_10.xlsx';
const xltxFile = '../tests/integration/files/Книга1.xltx';
const xlsmFile = '../tests/integration/files/Download-Sample-File-xlsm.xlsm';
const xltmFile = '../tests/integration/files/Книга1.xltm';
const xlsbFile = '../tests/integration/files/sample.xlsb';

const pptxFile = '../tests/integration/files/example.pptx';
const ppsxFile = '../tests/integration/files/1.ppsx';
const potxFile = '../tests/integration/files/sample.potx'; 
const pptmFile = '../tests/integration/files/1.pptm';
const ppsmFile = '../tests/integration/files/1.ppsm';
const potmFile = '../tests/integration/files/1.potm';

// Open Office file
const ottFile = '../tests/integration/files/sample3.ott';
const otsFile = '../tests/integration/files/sample.ots';
const odtFile = '../tests/integration/files/file-sample_100kB.odt';
const odsFile = '../tests/integration/files/file_example_ODS_10.ods';
const odpFile = '../tests/integration/files/file_example_ODP_200kB.odp';
const otpFile = '../tests/integration/files/2.otp';
const epubFile = '../tests/integration/files/sample.epub';

const xpsFile = '../tests/integration/files/example.xps';
const binaryDoctFile = '../tests/integration/files/editor.doct';
const binaryXlstFile = '../tests/integration/files/editor.pptt';
const binaryPpttFile = '../tests/integration/files/editor.xlst';

// OOX flat file
const odtFlatFile = '../tests/integration/files/Demo-Hayden-Management-v2-flat2.xml';
const xlsxFlatFile = '../tests/integration/files/Contoso_2014_Final_forMSFT_4 3 2014-flat.xml';
const docxPackageFile = '../tests/integration/files/Demo-Hayden-Management-v2-flat1.xml';
const pptxPackageFile = '../tests/integration/files/Contoso-Presentation-flat.xml';

const rtfFile = '../tests/integration/files/file-sample_300kB.rtf';
const pdfFile = '../tests/integration/files/file-sample_150kB.pdf';
const djvuFile = '../tests/integration/files/sample2.djvu';
const htmlFile =  '../tests/integration/files/example.html';

// Open Office flat file
const odtFlatFile1 = '../tests/integration/files/Untitled 1.fodt';
const odsFlatFile = '../tests/integration/files/Untitled 1.fods';

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

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX for docx files', () => {
		const docxBuffer = fs.readFileSync(docxFile);
		const format = getDocumentFormatByByte(docxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX for dotx files', () => {
		const dotxBuffer = fs.readFileSync(dotxFile);
		const format = getDocumentFormatByByte(dotxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM for docm files', () => {
		const docmBuffer = fs.readFileSync(docmFile);
		const format = getDocumentFormatByByte(docmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM for dotm files', () => {
		const dotmBuffer = fs.readFileSync(dotmFile);
		const format = getDocumentFormatByByte(dotmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM for ofor files', () => {
		const oforBuffer = fs.readFileSync(oforFile);
		const format = getDocumentFormatByByte(oforBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF for docxf files', () => {
		const docxfBuffer = fs.readFileSync(docxfFile);
		const format = getDocumentFormatByByte(docxfBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX for xlsx files', () => {
		const xlsxBuffer = fs.readFileSync(xlsxFile);
		const format = getDocumentFormatByByte(xlsxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX for xltx files', () => {
		const xltxBuffer = fs.readFileSync(xltxFile);
		const format = getDocumentFormatByByte(xltxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM for xlsm files', () => {
		const xlsmBuffer = fs.readFileSync(xlsmFile);
		const format = getDocumentFormatByByte(xlsmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM for xltm files', () => {
		const xltmBuffer = fs.readFileSync(xltmFile);
		const format = getDocumentFormatByByte(xltmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB for xlsb files', () => {
		const xlsbBuffer = fs.readFileSync(xlsbFile);
		const format = getDocumentFormatByByte(xlsbBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX for pptx files', () => {
		const pptxBuffer = fs.readFileSync(pptxFile);
		const format = getDocumentFormatByByte(pptxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM for ppsm files', () => {
		const ppsxBuffer = fs.readFileSync(ppsxFile);
		const format = getDocumentFormatByByte(ppsxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX for potx files', () => {
		const potxBuffer = fs.readFileSync(potxFile);
		const format = getDocumentFormatByByte(potxBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM for pptm files', () => {
		const pptmBuffer = fs.readFileSync(pptmFile);
		const format = getDocumentFormatByByte(pptmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM for ppsm files', () => {
		const ppsmBuffer = fs.readFileSync(ppsmFile);
		const format = getDocumentFormatByByte(ppsmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM for potm files', () => {
		const potmBuffer = fs.readFileSync(potmFile);
		const format = getDocumentFormatByByte(potmBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT for ott files', () => {
		const ottBuffer = fs.readFileSync(ottFile);
		const format = getDocumentFormatByByte(ottBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS for ots files', () => {
		const otsBuffer = fs.readFileSync(otsFile);
		const format = getDocumentFormatByByte(otsBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT for ODT files', () => {
		const odtBuffer = fs.readFileSync(odtFile);
		const format = getDocumentFormatByByte(odtBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS for ods files', () => {
		const odsBuffer = fs.readFileSync(odsFile);
		const format = getDocumentFormatByByte(odsBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP for odp files', () => {
		const odpBuffer = fs.readFileSync(odpFile);
		const format = getDocumentFormatByByte(odpBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP for otp files', () => {
		const otpBuffer = fs.readFileSync(otpFile);
		const format = getDocumentFormatByByte(otpBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB for epub files', () => {
		const epubBuffer = fs.readFileSync(epubFile);
		const format = getDocumentFormatByByte(epubBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS for XPS files', () => {
		const xpsBuffer = fs.readFileSync(xpsFile);
		const format = getDocumentFormatByByte(xpsBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CANVAS_WORD for binaryDoct files', () => {
		const binaryDoctBuffer = fs.readFileSync(binaryDoctFile);
		const format = getDocumentFormatByByte(binaryDoctBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CANVAS_WORD for binaryXlst files', () => {
		const binaryXlstBuffer = fs.readFileSync(binaryXlstFile);
		const format = getDocumentFormatByByte(binaryXlstBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT for binaryPptt files', () => {
		const binaryPpttBuffer = fs.readFileSync(binaryPpttFile);
		const format = getDocumentFormatByByte(binaryPpttBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT for odtFlat files', () => {
		const odtFlatBuffer = fs.readFileSync(odtFlatFile);
		const format = getDocumentFormatByByte(odtFlatBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT for xlsxFlat files', () => {
		const xlsxFlatBuffer = fs.readFileSync(xlsxFlatFile);
		const format = getDocumentFormatByByte(xlsxFlatBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE for docxPackage files', () => {
		const docxPackageBuffer = fs.readFileSync(docxPackageFile);
		const format = getDocumentFormatByByte(docxPackageBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE);
	});

	it('should return AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE for pptxPackage files', () => {
		const pptxPackageBuffer = fs.readFileSync(pptxPackageFile);
		const format = getDocumentFormatByByte(pptxPackageBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF for rtf files', () => {
		const rtfBuffer = fs.readFileSync(rtfFile);
		const format = getDocumentFormatByByte(rtfBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF for PDF files', () => {
		const pdfBuffer = fs.readFileSync(pdfFile);
		const format = getDocumentFormatByByte(pdfBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF);
	});

	it('should return AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU for DJVU files', () => {
		const djvuBuffer = fs.readFileSync(djvuFile);
		const format = getDocumentFormatByByte(djvuBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML for HTML files', () => {
		const htmlBuffer = fs.readFileSync(htmlFile);
		const format = getDocumentFormatByByte(htmlBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML);
	});

	it('should return AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT for odtFlat files', () => {
		const odtFlatBuffer = fs.readFileSync(odtFlatFile1);
		const format = getDocumentFormatByByte(odtFlatBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT);
	});

	it('should return AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT for odsFlat files', () => {
		const odsFlatBuffer = fs.readFileSync(odsFlatFile);
		const format = getDocumentFormatByByte(odsFlatBuffer);
		expect(format).toBe(constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT);
	});
});
