 # Comprehensive Testing Guide for ElevenLabs-Twilio AI Caller

This guide provides detailed information on how to test the ElevenLabs-Twilio AI Caller application. It is designed for all experience levels, from beginners to advanced users, with extremely granular details about our testing infrastructure.

## Table of Contents

1. [Introduction to Testing](#introduction-to-testing)
2. [Test Directory Structure](#test-directory-structure)
3. [Test Setup & Configuration](#test-setup--configuration)
   - [setup.js](#setupjs)
   - [common-setup.js](#common-setupjs)
   - [Environment Variables](#environment-variables)
4. [Mock Implementations](#mock-implementations)
   - [Twilio Mock](#twilio-mock)
   - [ElevenLabs Mock](#elevenlabs-mock)
   - [Make.com Webhook Mock](#makecom-webhook-mock)
   - [WebSocket Mock](#websocket-mock)
   - [Fastify Mock](#fastify-mock)
   - [Express Mock](#express-mock)
5. [Unit Tests](#unit-tests)
   - [Inbound Calls](#inbound-calls)
   - [Outbound Calls](#outbound-calls)
   - [Voicemail Detection](#voicemail-detection)
   - [Call Transfer](#call-transfer)
   - [WebSocket Communication](#websocket-communication)
   - [ElevenLabs Integration](#elevenlabs-integration)
   - [Webhook Data Handling](#webhook-data-handling)
   - [Intent-Based Features](#intent-based-features)
   - [Conference Monitoring](#conference-monitoring)
6. [Integration Tests](#integration-tests)
   - [Server Integration](#server-integration)
   - [Callback Workflow](#callback-workflow)
7. [Running Tests](#running-tests)
   - [Installation](#installation)
   - [Running All Tests](#running-all-tests)
   - [Running Specific Tests](#running-specific-tests)
   - [Coverage Reports](#coverage-reports)
8. [Advanced Testing Techniques](#advanced-testing-techniques)
   - [Test Isolation](#test-isolation)
   - [Mocking Strategies](#mocking-strategies)
   - [Asynchronous Testing](#asynchronous-testing)
9. [Troubleshooting & Debugging](#troubleshooting--debugging)
   - [Common Issues](#common-issues)
   - [Debugging Strategies](#debugging-strategies)
10. [Best Practices](#best-practices)
11. [Glossary of Testing Terms](#glossary-of-testing-terms)

## Introduction to Testing

Our test suite is designed to ensure that every component of the ElevenLabs-Twilio AI Caller application works correctly and reliably. We use a comprehensive testing approach that combines:

- **Unit Testing**: Verifies individual functions and components in isolation
- **Integration Testing**: Ensures components work together as expected
- **Mock Testing**: Simulates external dependencies to test behavior in controlled conditions

Our test framework uses the following technologies:

- **Jest**: A feature-rich JavaScript testing framework that provides test runners, assertions, and mocking capabilities
- **Supertest**: A HTTP testing library for testing API endpoints
- **@jest/globals**: Provides Jest's global functions like `describe`, `it`, and `expect`

## Test Directory Structure

Our test suite follows a well-organized structure to make testing efficient and maintainable:

```
test/
├── TEST_README.md           # This comprehensive testing guide
├── setup.js                 # Primary test setup and configuration
├── common-setup.js          # Shared setup functions across test files
├── mocks/                   # Enhanced mock implementations 
│   ├── twilio-mock.js       # Comprehensive Twilio SDK mock
│   ├── elevenlabs-mock.js   # ElevenLabs API and WebSocket mock
│   ├── make-mock.js         # Make.com webhook interactions mock
│   ├── websocket-mock.js    # WebSocket connection and events mock
│   └── ...                  # Other specialized mocks
├── outbound-calls.test.js   # Tests for outbound calling functionality  
├── inbound-calls.test.js    # Tests for inbound call routing
└── ...                      # Additional test files
```

## Test Setup & Configuration

### setup.js

`setup.js` is the primary configuration file for our test environment. It bootstraps all tests with necessary environment variables, mocks, and global configurations.

Key functionalities in `setup.js`:

1. **Environment Variable Setup**: Imports and calls `setupEnvironmentVariables()` from common-setup.js to establish baseline environment variables.

2. **Test Settings Container**: Provides a global `testSettings` object for configuring test behaviors:
   ```javascript
   global.testSettings = {
     // AMD (Answering Machine Detection) simulation result
     amdResult: 'human', // 'human', 'machine_start', 'machine_end_beep', etc.
     
     // User transcript simulation
     userTranscript: 'Hello, I need help with care services.',
     
     // AI response simulation
     aiResponse: 'I understand you need help with care services...',
     
     // Sales team availability
     salesTeamAvailable: true,
     
     // Skip AI responses for more controlled tests
     skipAiResponses: false
   };
   ```

3. **Test Callbacks Container**: Provides global callbacks for reacting to events during tests:
   ```javascript
   global.testCallbacks = {
     // Callback for Twilio status updates
     twilioStatusCallback: null,
     
     // Callback for Twilio AMD results
     twilioAmdCallback: null
   };
   ```

4. **External Dependency Mocking**: Configures Jest to mock external dependencies:
   ```javascript
   // Mock Twilio
   jest.mock('twilio', () => {
     return jest.fn((accountSid, authToken) => {
       return new TwilioMock(accountSid, authToken);
     });
   });
   
   // Mock WebSocket and other dependencies
   jest.mock('ws', () => MockWebSocket);
   
   // Replace global WebSocket
   global.WebSocket = MockElevenLabsWebSocket;
   
   // Mock axios for HTTP requests
   jest.mock('axios', () => mockAxios);
   ```

5. **Between-Test Cleanup**: Resets all mocks and test state before each test:
   ```javascript
   beforeEach(() => {
     jest.clearAllMocks();
     
     // Reset test settings to defaults
     global.testSettings = { ... };
     
     // Reset test callbacks
     global.testCallbacks = { ... };
     
     // Reset stores for conversation, webhooks, etc.
     resetConversationStore();
     clearWebhookStore();
     clearConnectionStore();
   });
   ```

6. **Mock Fastify Creation**: Provides a factory function for creating mock Fastify instances:
   ```javascript
   function createMockFastify() {
     // Implementation details...
   }
   ```

### common-setup.js

`common-setup.js` provides reusable setup functions, including:

1. **setupEnvironmentVariables()**: Sets required environment variables needed across tests:
   ```javascript
   export function setupEnvironmentVariables() {
     process.env.TWILIO_ACCOUNT_SID = 'ACmockedaccountsid';
     process.env.TWILIO_AUTH_TOKEN = 'mockedauthtoken';
     // Additional variables...
   }
   ```

2. **setupCommonMocks(jest)**: Configures commonly needed mocks:
   ```javascript
   export function setupCommonMocks(jest) {
     // Mock express module
     jest.mock('express', () => { ... });
     
     // Additional mocks...
   }
   ```

3. **Other utility functions**: For setup and configuration of the test environment.

### Environment Variables

Our tests use mock environment variables to ensure consistent testing:

| Variable | Test Value | Purpose |
|----------|------------|---------|
| TWILIO_ACCOUNT_SID | 'ACmockedaccountsid' | Mock Twilio account SID (must start with 'AC') |
| TWILIO_AUTH_TOKEN | 'mockedauthtoken' | Mock Twilio authentication token |
| TWILIO_PHONE_NUMBER | '+15551234567' | Mock Twilio phone number |
| SALES_TEAM_PHONE_NUMBER | '+15557654321' | Mock sales team phone number |
| ELEVENLABS_API_KEY | 'mocked-elevenlabs-api-key' | Mock ElevenLabs API key |
| ELEVENLABS_AGENT_ID | 'mocked-elevenlabs-agent-id' | Mock ElevenLabs agent ID |
| MAKE_WEBHOOK_URL | 'https://mock-make-webhook.com/trigger' | Mock webhook URL for notifications |
| PORT | '8001' | Server port for testing (defined in setup.js) |

## Mock Implementations

Our test suite uses sophisticated mocks to replace external dependencies and create controlled test environments. These mocks have been thoroughly enhanced to simulate real-world behaviors.

### Twilio Mock

**File: `test/mocks/twilio-mock.js`**

Our enhanced Twilio mock provides comprehensive simulation of the Twilio SDK, including:

- **Call Lifecycle**: Simulates the complete lifecycle of outbound and inbound calls
- **Status Callbacks**: Automatically triggers status callbacks as a real call would
- **Answering Machine Detection**: Simulates AMD with configurable results
- **Call Options Storage**: Preserves all call options for verification in tests

Key features:

```javascript
// Creating a call
const call = await twilioClient.calls.create({
  to: '+15551234567',
  from: '+15559876543',
  url: 'https://example.com/twiml',
  statusCallback: 'https://example.com/status',
  statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  machineDetection: 'Enable'
});

// Accessing call properties
console.log(call.sid); // 'CAxxxxxxxx'
console.log(call.status); // 'queued'

// Updating a call
await twilioClient.calls(call.sid).update({
  twiml: '<Response><Say>Hello</Say></Response>'
});

// Simulating call completion for testing
twilioClient.calls.completeCall(call.sid);
```

### ElevenLabs Mock

**File: `test/mocks/elevenlabs-mock.js`**

Our ElevenLabs mock provides complete simulation of:

- **WebSocket Communication**: Simulates real-time WebSocket interaction with ElevenLabs
- **Conversation Flow**: Mimics the back-and-forth conversation pattern
- **Audio Processing**: Simulates audio data transmission
- **Transcript Generation**: Provides realistic transcript events
- **Conversation Memory**: Maintains conversation history for later verification

Key features:

```javascript
// The mock provides realistic ElevenLabs WebSocket behavior
const elevenLabsWs = new MockElevenLabsWebSocket('wss://example.com');

// It simulates WebSocket initialization and connection
elevenLabsWs.on('open', () => {
  // Send conversation initialization
  elevenLabsWs.send(JSON.stringify({
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      agent: {
        prompt: { prompt: 'You are a helpful assistant' },
        first_message: 'Hello, how can I help you?'
      }
    }
  }));
});

// AI responses are simulated
elevenLabsWs.on('message', (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'transcript') {
    console.log('Transcript:', message.transcript_event.text);
  } else if (message.type === 'audio') {
    // Process audio data
  }
});

// Custom test utility to simulate user speech
elevenLabsWs.simulateUserSpeech('I need help with scheduling');

// Mock fetch responses for API calls
setupMockFetch();
```

### Make.com Webhook Mock

**File: `test/mocks/make-mock.js`**

Our make.com webhook mock provides:

- **HTTP Request Simulation**: Mocks axios for webhook delivery
- **Request Storage**: Stores all sent webhook data for verification
- **Response Simulation**: Provides configurable responses
- **Request Verification**: Includes utilities for finding and analyzing webhook calls

Key features:

```javascript
// The mock axios handles webhook requests
import { mockAxios, webhookStore, findWebhookCalls } from '../mocks/make-mock.js';

// Your code sends webhooks using axios
await axios.post('https://hook.make.com/trigger', { data: 'test' });

// Later in tests, verify the webhook was sent correctly
expect(webhookStore.sent.length).toBeGreaterThan(0);

// Find specific webhook calls matching criteria
const matchingCalls = findWebhookCalls({
  url: 'hook.make.com',
  data: { someField: 'expectedValue' }
});
expect(matchingCalls.length).toBe(1);
```

### WebSocket Mock

**File: `test/mocks/websocket-mock.js`**

Our WebSocket mock provides a complete simulation of WebSocket interactions:

- **Connection Lifecycle**: Simulates connecting, messaging, and disconnecting
- **Event Handling**: Supports the full range of WebSocket events
- **Message Storage**: Stores all messages for later verification
- **Connection Tracking**: Maintains a registry of all active connections
- **Fastify Integration**: Includes helpers for Fastify's WebSocket routes

Key features:

```javascript
// Mock global WebSocket
global.WebSocket = MockWebSocket;

// Your code creates a WebSocket
const ws = new WebSocket('wss://example.com');

// The mock simulates connection events
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'greeting' }));
});

// Later in tests, verify messages
const messages = connectionStore.messageHistory.filter(m => 
  m.direction === 'outgoing' && m.url === 'wss://example.com'
);
expect(messages.length).toBeGreaterThan(0);

// For Fastify routes, simulate connections
const socket = fastify.simulateWebsocketConnection('/my-websocket-route');
socket.simulateMessage(JSON.stringify({ type: 'hello' }));
```

### Fastify Mock

Provided by the `createMockFastify()` function in `setup.js`, our Fastify mock:

- **Simulates Route Registration**: Captures all registered routes for inspection
- **Handles WebSocket Registration**: Supports Fastify-WebSocket integration
- **Provides Mock Request/Response**: Simulates HTTP interaction
- **Tracks Route Calls**: Allows verification of handler invocation

Key features:

```javascript
// Create a mock Fastify instance
const fastify = createMockFastify();

// Register your routes
registerOutboundRoutes(fastify);

// Verify routes were registered
expect(fastify.routes.some(r => r.path === '/outbound-call')).toBe(true);

// Find and call a specific route handler
const handler = fastify.routes.find(r => r.path === '/outbound-call').handler;
const request = { body: { number: '+15551234567' } };
const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() };

await handler(request, reply);

// Verify handler behavior
expect(reply.send).toHaveBeenCalledWith(
  expect.objectContaining({ success: true })
);
```

## Unit Tests

Our unit tests provide focused testing of individual components. The key test files include:

### Outbound Calls

**File: `test/outbound-calls.test.js`**

Tests for outbound calling functionality, including:

- **Basic Route Registration**: Verifies all required routes are registered
- **Initiating Outbound Calls**: Tests the process of starting calls to leads and sales team
- **Call Status Flow**: Verifies status updates and AMD callback handling
- **Voicemail Detection**: Tests detection and handling of answering machines
- **WebSocket Communication**: Verifies media streaming with AI

Example test case:

```javascript
test('should handle voicemail detection', async () => {
  // Override AMD result for this test
  global.testSettings.amdResult = 'machine_end_beep';
  
  // Initiate a call...
  // Simulate AMD callback with voicemail...
  // Verify the AI is instructed to leave a voicemail...
  
  // Check webhook was sent with voicemail flag
  expect(webhookStore.sent.length).toBeGreaterThan(0);
  const webhookCall = webhookStore.sent.find(call => 
    call.data && call.data.is_voicemail === true
  );
  expect(webhookCall).toBeDefined();
});
```

### Inbound Calls

**File: `test/inbound-calls.test.js`**

Tests for inbound call handling, including:

- **Basic Route Registration**: Verifies all required routes are registered
- **Initial Call Handling**: Tests TwiML generation for caller greeting
- **Caller Verification**: Tests digit input processing and routing
- **Legacy Endpoint Redirection**: Verifies compatibility with legacy endpoints
- **WebSocket Communication**: Tests AI interaction via WebSockets

Example test case:

```javascript
test('should connect to AI assistant when caller presses 2', async () => {
  // Find the handler and create mock request/reply
  // ...
  
  // Call the handler
  await routeHandler(request, reply);
  
  // Verify TwiML response connects to AI
  const twimlResponse = reply.send.mock.calls[0][0];
  expect(twimlResponse).toContain('<Connect>');
  expect(twimlResponse).toContain('<Stream url="wss://');
  expect(twimlResponse).toContain('/inbound-ai-stream');
});
```

### Additional Test Areas

- **Voicemail Detection**: Tests AMD integration and voicemail handling
- **Call Transfer**: Tests smooth transfer between AI and human agents
- **WebSocket Communication**: Verifies real-time communication with Twilio and ElevenLabs
- **Intent-Based Features**: Tests callback scheduling and transfer triggers
- **Conference Monitoring**: Verifies tracking of conference participants and status

## Running Tests

### Installation

To run the test suite, first install all dependencies:

```bash
npm install
```

### Running All Tests

To run the complete test suite:

```bash
npm test
```

### Running Specific Tests

To run a specific test file:

```bash
npm test -- test/outbound-calls.test.js
```

To run tests matching a specific pattern:

```bash
npm test -- -t "should handle voicemail detection"
```

### Coverage Reports

To generate a test coverage report:

```bash
npm run test:coverage
```

## Advanced Testing Techniques

### Test Isolation

Our setup ensures complete test isolation:

- All mocks and stores are reset before each test
- Global test settings are restored to defaults
- External dependencies are consistently mocked

### Mocking Strategies

We use several advanced mocking strategies:

- **Behavior Simulation**: Mocks mimic real behavior of external services
- **State Tracking**: Stores maintain state for verification
- **Customization Points**: Global settings allow test-specific behaviors

Example of test customization:

```javascript
// Configure AMD to simulate voicemail
global.testSettings.amdResult = 'machine_end_beep';

// Configure user speech simulation
global.testSettings.userTranscript = 'I need to reschedule for tomorrow afternoon';

// Disable automatic AI responses for more control
global.testSettings.skipAiResponses = true;
```

### Asynchronous Testing

Our test suite properly handles asynchronous code:

- **WebSocket Events**: Properly waits for event handling
- **Timer Management**: Uses promises and setTimeout to handle timing
- **Async/Await**: Uses modern async patterns throughout

## Troubleshooting & Debugging

### Common Issues

See the original documentation for common issues and solutions.

### Debugging Strategies

To debug tests effectively:

1. **Enable Console Output**: Set the DEBUG environment variable:
   ```bash
   DEBUG=true npm test
   ```

2. **Inspect Store Contents**: Our mocks maintain detailed stores:
   ```javascript
   console.log(JSON.stringify(webhookStore.sent, null, 2));
   console.log(JSON.stringify(conversationStore.transcripts, null, 2));
   ```

3. **Use Custom Wait Functions**: For timing-sensitive tests:
   ```javascript
   // Wait for async operations to complete
   await new Promise(resolve => setTimeout(resolve, 500));
   ```

## Best Practices

When writing new tests or modifying existing ones:

1. **Use the Mocks Properly**: Leverage our enhanced mocks for realistic testing:
   ```javascript
   // Simulate a user saying something specific
   elevenLabsWs.simulateUserSpeech('I need to reschedule');
   
   // Verify the AI responded appropriately
   expect(conversationStore.transcripts).toContain(
     expect.objectContaining({ 
       speaker: 'agent', 
       text: expect.stringContaining('reschedule') 
     })
   );
   ```

2. **Reset Global Settings**: Always reset settings if you modify them:
   ```javascript
   // Setup
   const originalAmdResult = global.testSettings.amdResult;
   global.testSettings.amdResult = 'machine_end_beep';
   
   // Test code...
   
   // Reset
   global.testSettings.amdResult = originalAmdResult;
   ```

3. **Use Appropriate Assertions**: Use specific assertions for better error messages:
   ```javascript
   // Too general
   expect(response).toBeDefined();
   
   // Better
   expect(response).toHaveProperty('success', true);
   expect(response.data).toContain('expected value');
   ```

## Glossary of Testing Terms

See the original documentation for the glossary of testing terms.
