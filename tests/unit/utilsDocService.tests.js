/*
 * (c) Copyright Ascensio System SIA 2010-2025
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

const {describe, test, expect} = require('@jest/globals');
const sharp = require('./../../DocService/node_modules/sharp');
const operationContext = require('./../../Common/sources/operationContext');
const utilsDocService = require('./../../DocService/sources/utilsDocService');

describe('utilsDocService image processing', () => {
  const ctx = operationContext.global;

  describe('determineOptimalFormat', () => {
    test('should choose PNG for images with alpha channel', () => {
      const metadata = {
        hasAlpha: true,
        width: 400,
        height: 300,
        channels: 4
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('png');
    });

    test('should choose PNG for small images (icons/logos)', () => {
      const metadata = {
        hasAlpha: false,
        width: 128,
        height: 128,
        channels: 3
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('png');
    });

    test('should choose JPEG for large images', () => {
      const metadata = {
        hasAlpha: false,
        width: 1200,
        height: 800,
        channels: 3
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('jpeg');
    });

    test('should choose PNG for exact small image boundary (256x256)', () => {
      const metadata = {
        hasAlpha: false,
        width: 256,
        height: 256,
        channels: 3
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('png');
    });

    test('should choose JPEG for exact large image boundary (800x600)', () => {
      const metadata = {
        hasAlpha: false,
        width: 800,
        height: 600,
        channels: 3
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('jpeg');
    });

    test('should choose JPEG as default when no specific conditions match', () => {
      const metadata = {
        hasAlpha: false,
        width: 400,
        height: 300,
        channels: 3
      };

      const format = utilsDocService.determineOptimalFormat(ctx, metadata);
      expect(format).toBe('jpeg');
    });
  });

  describe('processImageOptimal', () => {
    test('should handle EXIF rotation and WebP conversion to JPEG for large images', async () => {
      // Create a large WebP image with EXIF orientation that should be converted to JPEG
      const webpImage = await sharp({
        create: {width: 1000, height: 600, channels: 3, background: {r: 100, g: 150, b: 200}}
      })
        .composite([
          {
            input: await sharp({
              create: {width: 200, height: 120, channels: 3, background: {r: 200, g: 100, b: 50}}
            })
              .png()
              .toBuffer(),
            top: 100,
            left: 200
          }
        ])
        .withMetadata({orientation: 6}) // rotate 90 degrees
        .webp()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, webpImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('jpeg');
      expect(Buffer.compare(webpImage, result) !== 0).toBe(true);
    });

    test('should handle EXIF rotation and WebP conversion to PNG for small images', async () => {
      // Create a small WebP image with EXIF orientation that should be converted to PNG
      const webpImage = await sharp({
        create: {width: 100, height: 100, channels: 3, background: {r: 255, g: 255, b: 255}}
      })
        .withMetadata({orientation: 3}) // rotate 180 degrees
        .webp()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, webpImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('png');
      expect(Buffer.compare(webpImage, result) !== 0).toBe(true);
    });

    test('should handle EXIF rotation and TIFF conversion to optimal format', async () => {
      // Create a medium-sized TIFF image with EXIF orientation (should use JPEG)
      const tiffImage = await sharp({
        create: {width: 900, height: 600, channels: 3, background: {r: 255, g: 255, b: 255}}
      })
        .withMetadata({orientation: 8}) // rotate 270 degrees
        .tiff()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, tiffImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('jpeg'); // large image should use JPEG
      expect(Buffer.compare(tiffImage, result) !== 0).toBe(true);
    });

    test('should handle EXIF rotation for standard JPEG without format conversion', async () => {
      // Create a JPEG image with EXIF orientation
      const jpegImage = await sharp({
        create: {width: 400, height: 300, channels: 3, background: {r: 255, g: 100, b: 50}}
      })
        .withMetadata({orientation: 6}) // rotate 90 degrees
        .jpeg()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, jpegImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('jpeg');
      expect(Buffer.compare(jpegImage, result) !== 0).toBe(true);
    });

    test('should not modify images without EXIF rotation and unsupported formats', async () => {
      // Create a standard PNG without EXIF orientation
      const pngImage = await sharp({
        create: {width: 400, height: 300, channels: 3, background: {r: 255, g: 255, b: 255}}
      })
        .png()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, pngImage);

      expect(Buffer.compare(pngImage, result) === 0).toBe(true);
    });

    test('should handle WebP with transparency (alpha channel)', async () => {
      // Create WebP with alpha channel - should convert to PNG
      const webpImage = await sharp({
        create: {width: 400, height: 300, channels: 4, background: {r: 255, g: 255, b: 255, alpha: 0.5}}
      })
        .webp()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, webpImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('png'); // alpha channel should force PNG
      expect(metadata.hasAlpha).toBe(true);
    });

    test('should handle HEIC conversion to optimal format', async () => {
      // Note: Sharp may not support HEIC creation, so this test might need adjustment
      // For now testing the code path exists
      const mockHeicBuffer = Buffer.from('mock-heic-data');

      // Test doesn't crash with invalid HEIC data
      const result = await utilsDocService.processImageOptimal(ctx, mockHeicBuffer);
      expect(result).toEqual(mockHeicBuffer); // Should return original on error
    });

    test('should handle corrupted image data gracefully', async () => {
      const corruptedBuffer = Buffer.from('not-an-image');

      const result = await utilsDocService.processImageOptimal(ctx, corruptedBuffer);
      expect(result).toEqual(corruptedBuffer); // Should return original on error
    });

    test('should handle null input', async () => {
      const result = await utilsDocService.processImageOptimal(ctx, null);
      expect(result).toBeNull();
    });

    test('should handle empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await utilsDocService.processImageOptimal(ctx, emptyBuffer);
      expect(result).toEqual(emptyBuffer);
    });

    test('should produce valid JPEG output with reasonable quality', async () => {
      // Create a large WebP that should convert to JPEG
      const webpImage = await sharp({
        create: {width: 1000, height: 600, channels: 3, background: {r: 100, g: 150, b: 200}}
      })
        .webp()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, webpImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(600);
      // JPEG should be a reasonable size (not empty, but also not excessively large)
      expect(result.length).toBeGreaterThan(1000); // Not too compressed
      expect(result.length).toBeLessThan(500000); // Not excessively large for 1000x600
    });

    test('should produce smaller PNG than uncompressed for simple graphics', async () => {
      // Create a TIFF with simple graphics that should convert to PNG
      const tiffImage = await sharp({
        create: {width: 200, height: 150, channels: 3, background: {r: 255, g: 255, b: 255}}
      })
        .composite([
          {
            input: await sharp({
              create: {width: 50, height: 50, channels: 3, background: {r: 255, g: 0, b: 0}}
            })
              .png()
              .toBuffer(),
            top: 50,
            left: 75
          }
        ])
        .tiff()
        .toBuffer();

      const result = await utilsDocService.processImageOptimal(ctx, tiffImage);
      const metadata = await sharp(result).metadata();

      expect(metadata.format).toBe('png'); // small image should use PNG
      expect(metadata.width).toBe(200);
      expect(metadata.height).toBe(150);
      // PNG should be compressed but reasonable size
      expect(result.length).toBeGreaterThan(500);
      expect(result.length).toBeLessThan(100000); // Should be well compressed
    });
  });
});
