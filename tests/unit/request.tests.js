// Required modules
const { describe, test, expect, beforeEach, afterAll, jest } = require('@jest/globals');
const { Readable, Writable } = require('stream');
// Setup mocks for axios
const axiosReal = require('axios');
jest.mock('axios');
const axios = require('axios');
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

// Assign real CancelToken from the imported axiosReal to the mocked axios
axios.CancelToken = axiosReal.CancelToken;
axios.CancelToken.source = axiosReal.CancelToken.source;

// Create operation context for tests
const ctx = new operationContext.Context();

// Helper functions for creating test streams
const createMockStream = (data) => {
  // Convert string to Buffer if it's not already a buffer
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data || JSON.stringify({ success: true }), 'utf8');
  // Create a Readable stream from buffer data
  return Readable.from(bufferData);
};

const createMockWriter = () => {
  const chunks = [];
  return new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });
};

// Common test parameters
const commonTestParams = {
  uri: 'https://example.com/api/data',
  timeout: { wholeCycle: '500ms', connectionAndInactivity: '200s' },
  limit: 1024 * 1024, // 1MB
  authorization: 'token123',
  filterPrivate: true,
  headers: { 'Accept': 'application/json' }
};

// Creates common parameter assertion
const createParamAssertion = (uri) => {
  return expect.objectContaining({
    url: uri || commonTestParams.uri,
    timeout: commonTestParams.timeout,
    maxContentLength: commonTestParams.limit,
    responseType: 'stream',
    headers: expect.objectContaining({
      'Accept': 'application/json',
      'Authorization': commonTestParams.authorization
    })
  });
};

describe('HTTP Request Functionality', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Clean up all mocks
    jest.restoreAllMocks();
  });

  describe('downloadUrlPromise', () => {
    test('properly handles content streaming', async () => {
      // Create mock data
      const mockData = 'Sample data content';
      
      // Mock successful response with stream
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': String(Buffer.byteLength(mockData, 'utf8'))
        },
        data: createMockStream(mockData)
      };

      // Setup axios mock - axios() is used directly in the code, not axios.get()
      axios.mockImplementation((config) => {
        console.log('Mock axios called with config:', JSON.stringify(config, null, 2));
        return Promise.resolve(mockResponse);
      });

      // Create a proper writable stream for testing
      const mockStreamWriter = createMockWriter();

      // Test version with stream writer (returns undefined)
      const resultWithStreamWriter = await utils.downloadUrlPromise(
        ctx,
        'https://example.com/file',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        mockStreamWriter
      );

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
      
      // With stream writer, the function returns undefined
      expect(resultWithStreamWriter).toBeUndefined();
    });

    test('returns complete response without stream writer', async () => {
      // Create mock data
      const mockData = JSON.stringify({ data: 'test content' });
      
      // Mock successful response with stream
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(mockData, 'utf8'))
        },
        data: createMockStream(mockData)
      };

      // Reset mocks and setup new behavior
      jest.clearAllMocks();
      axios.mockImplementation(() => Promise.resolve(mockResponse));

      // Call function without stream writer
      const result = await utils.downloadUrlPromise(
        ctx,
        'https://example.com/data',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null // No stream writer
      );

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
      
      // Verify full response object is returned
      expect(result).toBeDefined();
      expect(result).toHaveProperty('response', mockResponse);
      expect(result).toHaveProperty('sha256');
      expect(result).toHaveProperty('body');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/i);
      expect(Buffer.isBuffer(result.body)).toBe(true);
    });

    test('throws error on non-200 status codes', async () => {
      // Create error data
      const errorData = JSON.stringify({ error: 'Not found' });
      
      // Mock error response with stream
      const mockErrorResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(errorData, 'utf8'))
        },
        data: createMockStream(errorData)
      };

      // Reset mocks and setup new behavior for error
      jest.clearAllMocks();
      axios.mockImplementation(() => Promise.resolve(mockErrorResponse));

      // Call function and expect it to throw
      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/not-found',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      )).rejects.toThrow(/Error response: statusCode:404/);

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('throws error when content-length exceeds limit', async () => {
      // Create large data (but mock only returns the header)
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '2097152' // 2MB (greater than 1MB limit)
        },
        data: createMockStream('{}') // actual data is irrelevant, header check happens first
      };

      // Reset mocks and setup new behavior
      jest.clearAllMocks();
      axios.mockImplementation(() => Promise.resolve(mockResponse));

      // Call function with a 1MB limit and expect it to throw
      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/large-file',
        commonTestParams.timeout,
        1024 * 1024, // 1MB limit
        null,
        false,
        null,
        null
      )).rejects.toThrow(/EMSGSIZE: Error response: content-length/);

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('follows redirects correctly', async () => {
      // Create a counter to track calls
      let callCount = 0;
      
      // Mock redirect response
      const redirectResponse = {
        status: 302,
        headers: {
          location: 'https://example.com/redirected'
        }
      };

      // Mock success response after redirect
      const successData = JSON.stringify({ success: true });
      const successResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(successData, 'utf8'))
        },
        data: createMockStream(successData)
      };

      // Reset mocks and implement redirect then success
      jest.clearAllMocks();
      axios.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          // First call - simulate redirect by throwing error with response
          const err = new Error('Redirect');
          err.response = redirectResponse;
          return Promise.reject(err);
        } else {
          // Second call - return success
          return Promise.resolve(successResponse);
        }
      });

      // Call function with original URL
      const result = await utils.downloadUrlPromise(
        ctx,
        'https://example.com/original',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      );

      // Verify axios was called twice (once for original, once for redirect)
      expect(axios).toHaveBeenCalledTimes(2);
      
      // Verify the result is from the successful redirect
      expect(result).toBeDefined();
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('sha256');
      expect(result.response.status).toBe(200);
    });

    test('handles network errors correctly', async () => {
      // Reset mocks and implement network error
      jest.clearAllMocks();
      axios.mockImplementation(() => {
        const err = new Error('Network Error');
        return Promise.reject(err);
      });

      // Call function and expect network error
      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/network-error',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      )).rejects.toThrow('Network Error');

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('handles binary data correctly', async () => {
      // Create binary data (simple buffer with pattern of bytes)
      const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG file signature
      
      // Mock successful response with binary stream
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(binaryData.length)
        },
        data: createMockStream(binaryData)
      };

      // Reset mocks and setup for binary data
      jest.clearAllMocks();
      axios.mockImplementation(() => Promise.resolve(mockResponse));

      // Call function without stream writer
      const result = await utils.downloadUrlPromise(
        ctx,
        'https://example.com/image.png',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      );

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
      
      // Verify binary data is preserved correctly
      expect(result).toBeDefined();
      expect(result).toHaveProperty('body');
      expect(Buffer.isBuffer(result.body)).toBe(true);
      expect(result.body.length).toBe(binaryData.length);
      // Verify the content matches the original binary data
      expect(Buffer.compare(result.body, binaryData)).toBe(0);
    });

    test('handles timeout correctly', async () => {
      jest.useFakeTimers();
      // Mock a never-resolving request
      axios.mockImplementation((config) => {
        return new Promise((_, reject) => {
          if (config.cancelToken) {
            config.cancelToken.promise.then(cancel => {
              reject(new axiosReal.Cancel(cancel.message));
            });
          }
        });
      });

      const promise = utils.downloadUrlPromise(
        ctx,
        'https://example.com/timeout-test',
        { wholeCycle: '500ms', connectionAndInactivity: '200s' },
        1024,
        null,
        false,
        null,
        null
      );

      // Fast-forward exactly 1 second
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Flush pending promises

      await expect(promise).rejects.toThrow('ETIMEDOUT: 500ms');

      jest.useRealTimers();
    });

    test('throws an error on max redirects limit reached', async () => {
      // Create a counter to track calls
      let callCount = 0;
      
      // Mock redirect response
      const redirectResponse = {
        status: 302,
        headers: {
          location: 'https://example.com/redirected'
        }
      };

      // Mock success response after redirect
      const successData = JSON.stringify({ success: true });
      const successResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(successData, 'utf8'))
        },
        data: createMockStream(successData)
      };

      // Reset mocks and implement redirect then success
      jest.clearAllMocks();
      axios.mockImplementation(() => {
        if (callCount < 12) {
          callCount++;
          // First call - simulate redirect by throwing error with response
          const err = new Error('Redirect');
          err.response = redirectResponse;
          return Promise.reject(err);
        } else {
          // Second call - return success
          return Promise.resolve(successResponse);
        }
      });

      // Call function with original URL
      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/original',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      )).rejects.toThrow('Redirect');

       expect(axios).toHaveBeenCalledTimes(11);
    });

    test('should block external request', async () => {

      const addExternalRequestOptionsMock = jest.spyOn(utils, 'addExternalRequestOptions');
  
      addExternalRequestOptionsMock.mockReturnValue(false);  

      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/original',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      )).rejects.toThrow('Block external request. See externalRequest config options');

      addExternalRequestOptionsMock.mockRestore();
    });

    test('should throw error on redirect with followRedirect=false', async () => {
      let callCount = 0;
      
      // Mock redirect response
      const redirectResponse = {
        status: 302,
        headers: {
          location: 'https://example.com/redirected'
        }
      };

      // Mock success response after redirect
      const successData = JSON.stringify({ success: true });
      const successResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(successData, 'utf8'))
        },
        data: createMockStream(successData)
      };

      // Reset mocks and implement redirect then success
      jest.clearAllMocks();
      axios.mockImplementation(() => {
        if (callCount < 2) {
          callCount++;
          // First call - simulate redirect by throwing error with response
          const err = new Error('Redirect');
          err.response = redirectResponse;
          return Promise.reject(err);
        } else {
          // Second call - return success
          return Promise.resolve(successResponse);
        }
      });

      const ctx = {
        getCfg: function(key, _) {
          switch (key) {
            case 'services.CoAuthoring.requestDefaults':
              return {
                "headers": {
                  "User-Agent": "Node.js/6.13",
                  "Connection": "Keep-Alive"
                },
                "decompress": true,
                "rejectUnauthorized": true,
                "followRedirect": false
              }
            case 'services.CoAuthoring.token.outbox.header':
              return "Authorization";
            case 'services.CoAuthoring.token.outbox.prefix':
              return "Bearer ";
            case 'externalRequest.action':
              return {
                "allow": true,
                "blockPrivateIP": true,
                "proxyUrl": "",
                "proxyUser": {
                  "username": "",
                  "password": ""
                },
                "proxyHeaders": {
                }
              };
            case 'services.CoAuthoring.request-filtering-agent':
              return {
                "allowPrivateIPAddress": false,
                "allowMetaIPAddress": false
              }
            case 'externalRequest.directIfIn':
              return {
                "allowList": [],
                "jwtToken": true
              }
          }
        },
        logger: {
          debug: function() {},
        }
      }

      await expect(utils.downloadUrlPromise(
        ctx,
        'https://example.com/original',
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null,
        null
      )).rejects.toThrow('Redirect');
    });
  });

  describe('postRequestPromise', () => {
    test('properly sends post data and returns response', async () => {
      // Mock successful response
      const mockData = { success: true };
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: mockData
      };
    
      // Setup axios mock
      axios.mockImplementation(() => Promise.resolve(mockResponse));
    
      // Call the function
      const result = await utils.postRequestPromise(
        ctx,
        'https://example.com/data',
        { key: 'value' },
        null,
        null,
        commonTestParams.timeout,
        commonTestParams.authorization,
        false,
        null
      );
    
      // Verify axios was called with the correct configuration
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'post',
        url: 'https://example.com/data',
        data: { key: 'value' },
        validateStatus: expect.any(Function), 
        timeout: expect.any(Number),
      }));
    
      expect(result).toBeDefined();
      expect(result).toHaveProperty('response');
      expect(result.response.statusCode).toBe(200);
      expect(result.response.body).toBe(mockData);
    });
    

    test('handles timeout and cancels request', async () => {
      // Mock cancellation
      const cancelMessage = 'Whole request cycle timeout: 500ms';
      axios.mockImplementation(() => {
        const error = new Error(cancelMessage);
        error.code = 'ETIMEDOUT';
        throw error;
      });

      // Call function and expect it to throw ETIMEDOUT error
      await expect(utils.postRequestPromise(
        ctx,
        'https://example.com/data',
        { key: 'value' },
        null,
        null,
        commonTestParams.timeout,
        commonTestParams.authorization,
        false,
        null
      )).rejects.toThrowError(cancelMessage);

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('throws error for non-200 status codes', async () => {
      // Create mock error data
      const errorData = JSON.stringify({ error: 'Not found' });
      const mockErrorResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(errorData, 'utf8'))
        },
        data: errorData
      };

      // Setup axios mock
      axios.mockImplementation(() => Promise.reject({ response: mockErrorResponse }));

      // Call function and expect it to throw error
      await expect(utils.postRequestPromise(
        ctx,
        'https://example.com/not-found',
        { key: 'value' },
        null,
        null,
        commonTestParams.timeout,
        commonTestParams.authorization,
        false,
        null
      )).rejects.toThrowError(/Error response: statusCode:404/);

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('handles post data stream correctly', async () => {
      // Mock successful response with stream
      const mockData = 'Sample streamed content';
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(mockData, 'utf8'))
        },
        data: mockData
      };
    
      // Setup axios mock
      axios.mockImplementation(() => Promise.resolve(mockResponse));
    
      // Call the function with postDataStream
      const result = await utils.postRequestPromise(
        ctx,
        'https://example.com/upload',
        null,
        mockData,
        null,
        commonTestParams.timeout,
        commonTestParams.authorization,
        false,
        null
      );
    
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'post',
        url: 'https://example.com/upload',
        headers: expect.objectContaining({
          'Authorization': 'Bearer token123'
        }),
        data: mockData,
        validateStatus: expect.any(Function),
        timeout: expect.any(Number),
      }));
    
      // Verify result
      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(result.response.body).toBe(mockData);
    });

    test('handles network errors correctly', async () => {
      // Mock network error
      const networkError = new Error('Network Error');
      axios.mockImplementation(() => Promise.reject(networkError));

      // Call function and expect it to throw network error
      await expect(utils.postRequestPromise(
        ctx,
        'https://example.com/network-error',
        { key: 'value' },
        null,
        null,
        commonTestParams.timeout,
        commonTestParams.authorization,
        false,
        null
      )).rejects.toThrowError('Network Error');

      // Verify axios was called
      expect(axios).toHaveBeenCalledTimes(1);
    });
  })
});