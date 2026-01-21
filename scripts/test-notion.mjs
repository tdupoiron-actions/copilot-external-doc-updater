/**
 * Manual integration test for Notion MCP connection using GitHub Copilot SDK.
 *
 * This script demonstrates the AI-driven approach where the Copilot SDK
 * connects to the Notion MCP server and lets the AI decide which tools to use.
 *
 * Usage:
 *   NOTION_TOKEN=your_token NOTION_PAGE_ID=your_page_id node scripts/test-notion.mjs
 *
 * Or create a .env file (don't commit it!) with:
 *   NOTION_TOKEN=your_token
 *   NOTION_PAGE_ID=your_page_id
 *
 * Then run:
 *   node scripts/test-notion.mjs
 *   node scripts/test-notion.mjs --create-test
 */

import { CopilotClient } from '@github/copilot-sdk';

// Load .env file if it exists
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch {
  // dotenv not installed, use environment variables directly
}

async function testNotionConnection() {
  const notionToken = process.env.NOTION_TOKEN;
  const notionPageId = process.env.NOTION_PAGE_ID;

  if (!notionToken) {
    console.error('❌ NOTION_TOKEN environment variable is required');
    console.log('\nUsage:');
    console.log('  NOTION_TOKEN=xxx NOTION_PAGE_ID=yyy node scripts/test-notion.mjs');
    process.exit(1);
  }

  if (!notionPageId) {
    console.error('❌ NOTION_PAGE_ID environment variable is required');
    console.log('\nUsage:');
    console.log('  NOTION_TOKEN=xxx NOTION_PAGE_ID=yyy node scripts/test-notion.mjs');
    process.exit(1);
  }

  console.log('🔌 Initializing Copilot SDK with Notion MCP server...\n');
  console.log(`   Token: ${notionToken.substring(0, 10)}...${notionToken.substring(notionToken.length - 5)}`);
  console.log(`   Page ID: ${notionPageId}\n`);

  // Initialize Copilot client with environment variables passed to CLI
  const client = new CopilotClient({
    env: {
      ...process.env,
      NOTION_TOKEN: notionToken,
    },
  });

  try {
    await client.start();
    console.log('✅ Copilot client started\n');

    // Create a session with Notion MCP server configured
    // The AI will have access to all Notion tools and decide which to use
    const session = await client.createSession({
      model: 'gpt-4o',
      streaming: true,
      mcpServers: {
        notion: {
          type: 'local',
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: {
            NOTION_TOKEN: notionToken,
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_OPTIONS: '--no-warnings', // Suppress experimental warnings
          },
          tools: ['*'], // Allow all Notion tools
        },
      },
      systemMessage: {
        content: `You are a helpful assistant that can interact with Notion using the available MCP tools.
You have access to various Notion API tools through the Notion MCP server.
When searching or retrieving pages, handle errors gracefully and provide clear feedback.
The target Notion page ID is: ${notionPageId}
Be concise in your responses and explain which tools you're using.`,
      },
    });

    console.log(`📋 Session created: ${session.sessionId}\n`);

    // Subscribe to session events to see AI responses and tool usage
    session.on((event) => {
      if (event.type === 'assistant.message_delta') {
        process.stdout.write(event.data.deltaContent);
      } else if (event.type === 'tool.execution_start') {
        console.log(`\n🔧 AI using tool: ${event.data.toolName}`);
      } else if (event.type === 'tool.execution_end') {
        console.log(`   ✅ Tool completed: ${event.data.toolName}\n`);
      } else if (event.type === 'assistant.message') {
        console.log('\n');
      }
    });

    // Test 1: Let AI explore the page
    console.log('━'.repeat(60));
    console.log('🤖 Test 1: Retrieving page information...');
    console.log('━'.repeat(60));

    await session.sendAndWait({
      prompt: `Please retrieve information about the Notion page with ID "${notionPageId}" and tell me its title and basic details. Use the appropriate Notion API tool.`,
    });

    // Test 2: Let AI search for Changelog
    console.log('\n' + '━'.repeat(60));
    console.log('🤖 Test 2: Searching for Changelog page...');
    console.log('━'.repeat(60));

    await session.sendAndWait({
      prompt: `Search for any page named "Changelog" that is a child of the page with ID "${notionPageId}". Tell me if you found one and its details.`,
    });

    // Test 3: Optionally create a test entry (AI decides how)
    const createTest = process.argv.includes('--create-test');
    if (createTest) {
      console.log('\n' + '━'.repeat(60));
      console.log('🤖 Test 3: Creating test changelog entry...');
      console.log('━'.repeat(60));

      const testDate = new Date().toISOString();
      await session.sendAndWait({
        prompt: `Create a test changelog entry on the page with ID "${notionPageId}". 
Add a heading "🧪 Test Entry - ${testDate}" followed by a paragraph saying 
"This is a test entry created by the Copilot SDK integration test script." 
and then add a divider. Use the appropriate Notion API tool to append these blocks.`,
      });
    } else {
      console.log(
        '\n💡 Tip: Run with --create-test to let the AI create a test entry in Notion\n'
      );
    }

    console.log('🎉 All AI-driven tests completed!\n');

    // Clean up
    await session.destroy();
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error('\nTroubleshooting:');
    console.error('  1. Verify your NOTION_TOKEN is valid');
    console.error('  2. Ensure the integration has access to the page');
    console.error('  3. Check that the NOTION_PAGE_ID is correct');
    console.error('  4. Make sure you have GitHub Copilot CLI installed\n');
    process.exit(1);
  } finally {
    await client.stop();
    console.log('🔌 Copilot client stopped');
  }
}

testNotionConnection();
