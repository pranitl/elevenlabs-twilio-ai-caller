# Comprehensive Testing Guide for ElevenLabs-Twilio AI Caller

This guide provides detailed information on how to test the ElevenLabs-Twilio AI Caller application. It is designed for all experience levels, from beginners to advanced users.

## Table of Contents

1. [Introduction to Testing](#introduction-to-testing)
2. [Quick Start](#quick-start)
3. [Testing Setup](#testing-setup)
4. [Running Tests](#running-tests)
5. [Understanding Test Output](#understanding-test-output)
6. [Test Structure](#test-structure)
7. [Common Testing Patterns](#common-testing-patterns)
8. [Writing New Tests](#writing-new-tests)
9. [Key Testing Concepts](#key-testing-concepts)
10. [Troubleshooting](#troubleshooting)
11. [Best Practices](#best-practices)

## Introduction to Testing

Testing ensures your code works correctly and continues to work as you make changes. Our test suite uses:

- **Jest**: A JavaScript testing framework
- **Supertest**: For HTTP assertions
- **Mock-Socket**: For WebSocket mocking
- **Jest Mock Extended**: For enhanced mocking capabilities

Tests are divided into:

- **Unit Tests**: Test individual functions and components in isolation
- **Integration Tests**: Test how components work together

## Quick Start

### Installing Dependencies

First, ensure you have Node.js and npm installed. Then install the dependencies:

```bash
npm install
```

### Running Your First Test

Start by running a single test to make sure everything is set up correctly:

```bash
# Run the inbound-calls test
npm test -- test/unit/inbound-calls.test.js
```

### Running All Tests

To run all tests in the project:

```bash
npm test
```

### Running Tests with Coverage

To see how much of your code is covered by tests:

```bash
npm run test:coverage
```

### Running Tests in Watch Mode

During development, you can have tests run automatically when files change:

```bash
npm run test:watch
```

## Testing Setup

### Environment Variables

Tests use mock environment variables defined in `test/setup.js`:

```javascript
// Mock environment variables
process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-api-key';
process.env.ELEVENLABS_AGENT_ID = 'test-elevenlabs-agent-id';
process.env.TWILIO_ACCOUNT_SID = 'test-twilio-account-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-auth-token';
process.env.TWILIO_PHONE_NUMBER = '+18001234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+18009876543';
process.env.PORT = '8001';
```

You don't need to set up real environment variables for testing.

### Mocks

External dependencies are mocked to prevent actual API calls during testing:

- **Twilio**: Mock client in `test/mocks/twilio.js`
- **WebSocket**: Mock implementation in `test/mocks/ws.js`
- **Fastify**: Mock server in `test/mocks/fastify.js`
- **Fetch API**: Mocked in `test/setup.js`

## Running Tests

### Running Specific Tests

To run tests from a specific file:

```bash
npm test -- test/unit/inbound-calls.test.js
```

To run only tests with names matching a pattern:

```bash
npm test -- -t "should register routes"
```

### Testing Specific Components

```bash
# Testing Inbound Calls
npm test -- test/unit/inbound-calls.test.js

# Testing Outbound Call Routes
npm test -- test/unit/outbound-calls-routes.test.js

# Testing WebSocket Functionality
npm test -- test/unit/outbound-calls-websocket.test.js

# Testing ElevenLabs Integration
npm test -- test/unit/outbound-calls-elevenlabs.test.js

# Testing Voicemail Detection and Handling
npm test -- test/unit/voicemail-detection.test.js

# Testing Call Transfer Functionality
npm test -- test/unit/call-transfer.test.js

# Testing Sales Team Unavailability
npm test -- test/unit/sales-team-unavailable.test.js

# Testing Webhook Data Handling
npm test -- test/unit/webhook-data.test.js

# Testing Server Integration
npm test -- test/integration/server.test.js
```

## Understanding Test Output

When you run tests, you'll see output similar to this:

```
PASS test/unit/inbound-calls.test.js
  Inbound Calls Module
    registerInboundRoutes
      ✓ should throw error if SALES_TEAM_PHONE_NUMBER is missing (3ms)
      ✓ should register /incoming-call route (1ms)
      ✓ should register /incoming-call-eleven route
    /incoming-call handler
      ✓ should return TwiML that forwards call to sales team (4ms)
    /incoming-call-eleven handler
      ✓ should return TwiML that forwards call to sales team (1ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        0.583s, estimated 1s
```

- **PASS/FAIL**: Overall status of the test file
- **✓**: Indicates a passing test
- **✗**: Indicates a failing test (with details about what failed)
- **Test Suites**: Summary of test files
- **Tests**: Summary of individual tests
- **Time**: How long the tests took to run

For coverage reports, you'll see additional statistics:

```
--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-------------------
All files     |   85.71 |    76.92 |   90.00 |   85.71 |                  
 index.js     |   90.00 |    75.00 |  100.00 |   90.00 | 45                
 inbound.js   |   81.82 |    80.00 |   75.00 |   81.82 | 18,24            
--------------|---------|----------|---------|---------|-------------------
```

## Test Structure

### Test Directory Structure

```
test/
├── integration/     # Integration tests for components working together
│   └── server.test.js
├── mocks/           # Mock implementations of external dependencies
│   ├── fastify.js
│   ├── twilio.js
│   └── ws.js
├── unit/            # Unit tests for individual components
│   ├── inbound-calls.test.js
│   ├── index.test.js
│   ├── outbound-calls-elevenlabs.test.js
│   ├── outbound-calls-routes.test.js
│   ├── outbound-calls-websocket.test.js
│   ├── voicemail-detection.test.js      # Tests for voicemail detection and handling
│   ├── call-transfer.test.js            # Tests for AI-to-sales team call transfers
│   ├── sales-team-unavailable.test.js   # Tests for sales team unavailability scenario
│   └── webhook-data.test.js             # Tests for webhook data formatting and sending
├── README.md        # This guide
└── setup.js         # Global test setup
```

### Test Files Explanation

#### Unit Tests:
- `inbound-calls.test.js`: Tests for inbound call handling
- `index.test.js`: Tests for server setup
- `outbound-calls-routes.test.js`: Tests for API endpoints in outbound-calls.js
- `outbound-calls-websocket.test.js`: Tests for WebSocket handling
- `outbound-calls-elevenlabs.test.js`: Tests for ElevenLabs integration
- `voicemail-detection.test.js`: Tests for voicemail detection and handling (AMD and transcript-based)
- `call-transfer.test.js`: Tests for transfer logic and conference room management
- `sales-team-unavailable.test.js`: Tests for behavior when sales team is unavailable
- `webhook-data.test.js`: Tests for webhook data formatting and sending

#### Integration Tests:
- `server.test.js`: Tests for the complete server with all routes

#### Mocks:
- `fastify.js`: Mocks for Fastify framework
- `twilio.js`: Mocks for Twilio SDK
- `ws.js`: Mocks for WebSocket

### Test Anatomy

Each test file follows this structure:

```javascript
// Imports
import { jest, describe, it, expect } from '@jest/globals';

// Mocks are set up before importing the module being tested
jest.mock('some-module', () => ({ someFunction: jest.fn() }));

// Import the module to test
import { functionToTest } from '../../module.js';

// Test suite
describe('Module Name', () => {
  // Test group
  describe('functionToTest', () => {
    // Individual test
    it('should do something expected', () => {
      // Arrange: Set up test conditions
      const input = 'test input';
      
      // Act: Call the function
      const result = functionToTest(input);
      
      // Assert: Check the result
      expect(result).toBe('expected output');
    });
  });
});
```

## Common Testing Patterns

### 1. Testing API Endpoints

When testing API endpoints, we verify:
- The correct status code is returned
- The response body contains expected data
- Error cases are handled properly

Example:

```javascript
it('should return 400 if phone number is missing', async () => {
  const response = await request(fastify.server)
    .post('/outbound-call-to-sales')
    .send({})
    .expect(400);
  
  expect(response.body.error).toBe('Phone number is required');
});
```

### 2. Testing Utility Functions

When testing utility functions, we verify:
- The function returns the expected output for given inputs
- Edge cases are handled correctly
- Errors are thrown or handled appropriately

Example:

```javascript
it('should format the phone number correctly', () => {
  const result = formatPhoneNumber('8001234567');
  expect(result).toBe('+18001234567');
});
```

### 3. Testing WebSocket Communication

When testing WebSocket communication, we verify:
- Connections are established correctly
- Messages are sent in the expected format
- Received messages are processed correctly
- Connections are closed properly

See `test/unit/outbound-calls-websocket.test.js` for examples.

### 4. Testing Voicemail Detection

When testing voicemail detection, we verify:
- AMD (Answering Machine Detection) callbacks are handled properly
- Transcript-based voicemail detection works correctly
- The AI agent adapts its behavior when a voicemail is detected
- The sales team is notified when a voicemail is detected (if connected)

Example:

```javascript
it('should mark call as voicemail when AMD detects machine_start', async () => {
  // Set up request body for AMD callback
  mockReq.body = {
    CallSid: 'CA12345',
    AnsweredBy: 'machine_start'
  };
  
  // Call the AMD callback handler
  await amdCallbackHandler(mockReq, { send: jest.fn() });
  
  // Verify call is marked as voicemail
  expect(global.callStatuses['CA12345'].isVoicemail).toBe(true);
});
```

### 5. Testing Call Transfer

When testing call transfer functionality, we verify:
- Both calls must be in-progress before a transfer is initiated
- A conference room is created with the right parameters
- The transfer is marked as complete
- The ElevenLabs connection is closed after transfer

Example:

```javascript
it('should create a conference when both calls are in-progress', async () => {
  // Update both lead and sales calls to in-progress
  await leadStatusHandler(mockRequest, mockReply);
  await salesStatusHandler(mockRequest, mockReply);
  
  // Verify both calls were updated to join the conference
  expect(twilioClient.calls().update).toHaveBeenCalledWith(
    expect.objectContaining({
      twiml: expect.stringContaining('<Conference')
    })
  );
  
  // Check that transfer was marked as complete
  expect(callStatuses[leadCallSid].transferComplete).toBe(true);
});
```

## Writing New Tests

### Basic Test Template

```javascript
import { jest, describe, it, expect } from '@jest/globals';
import '../setup.js';

// Import the module to test
import { myFunction } from '../../path-to-module.js';

describe('My Module', () => {
  it('should perform expected behavior', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected result');
  });
});
```

### Mocking Dependencies

```javascript
// Mock a module
jest.mock('module-name', () => ({
  functionName: jest.fn().mockReturnValue('mocked value')
}));

// Mock a global function
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ data: 'mock data' })
});
```

### Testing Asynchronous Code

```javascript
it('should handle async operations', async () => {
  // Arrange
  const input = 'test';
  
  // Act
  const result = await asyncFunction(input);
  
  // Assert
  expect(result).toBe('expected result');
});
```

## Key Testing Concepts

### 1. Mocking

Mocking replaces real dependencies with test doubles that simulate their behavior. Benefits include:
- Isolating the code under test
- Controlling dependency behavior
- Avoiding side effects like network calls or database writes
- Simulating edge cases and error conditions

### 2. Isolation

Tests should be independent from each other:
- One test should not affect another test
- Tests should not have side effects that persist beyond the test
- Use `beforeEach` and `afterEach` to set up and clean up test environments

### 3. Coverage

Test coverage measures how much of your code is executed by tests:
- **Statement coverage**: Percentage of code statements executed
- **Branch coverage**: Percentage of logical branches executed
- **Function coverage**: Percentage of functions called
- **Line coverage**: Percentage of code lines executed

## Troubleshooting

### Common Issues

#### 1. "SyntaxError: Cannot use import statement outside a module"

This occurs when your Jest configuration isn't set up correctly for ES Modules.

**Solution**: Check that your Jest configuration in package.json is set up correctly:

```json
"jest": {
  "transform": {},
  "moduleNameMapper": {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  "testEnvironment": "node"
}
```

#### 2. "Cannot find module"

**Solution**: 
- Check the import path is correct
- Ensure the file exists in the specified location
- Verify the module is installed (check package.json and node_modules)

#### 3. "Timeout - Async callback was not invoked within the timeout"

This happens when asynchronous tests don't properly signal completion.

**Solution**:
- Make sure async functions are awaited
- Check that promises are being resolved or rejected
- Increase the timeout with `jest.setTimeout(10000)` at the top of your test file

#### 4. Mock not working correctly

**Solution**:
- Ensure mocks are defined before importing the module being tested
- Check the mock implementation matches how the function is used in the code
- Use `jest.clearAllMocks()` in beforeEach to reset mocks between tests

### Debugging Tests

To debug tests:

1. Add `console.log()` statements to see values during test execution
2. Use `.only` to focus on specific tests:

```javascript
// Only this test will run
it.only('should do something', () => {
  // test code
});
```

3. Use Node.js debugging with the `--inspect` flag:

```bash
node --inspect-brk node_modules/jest/bin/jest.js --runInBand path/to/test.js
```

## Best Practices

### 1. Follow the AAA Pattern

Structure your tests using the Arrange-Act-Assert pattern:
- **Arrange**: Set up test conditions
- **Act**: Execute the code being tested
- **Assert**: Verify the results

### 2. Keep Tests Independent

- Each test should run in isolation
- Tests should not depend on the order of execution
- Use `beforeEach` to reset state between tests

### 3. Test Behavior, Not Implementation

- Focus on what the code does, not how it does it
- Tests should remain valid even if implementation details change
- Avoid testing private methods directly

### 4. Write Readable Tests

- Give tests descriptive names
- Use clear variable names and comments
- Use helper functions to reduce duplication

### 5. Maintain Test Quality

- Treat test code with the same care as production code
- Refactor tests when needed
- Keep tests fast, reliable, and maintainable

---

For more information, refer to:
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Mock-Socket Documentation](https://github.com/thoov/mock-socket) 