// test-notion-api.mjs
import { NotionApiClient } from '../src/formats/notion-api/notion-client.js';
import { NotionToMarkdownConverter } from '../src/formats/notion-api/notion-to-md.js';
import { BaseGenerator } from '../src/formats/notion-api/base-generator.js';

async function testNotionApi() {
    const token = process.env.NOTION_TOKEN;
    
    if (!token) {
        console.error('Please set NOTION_TOKEN environment variable');
        console.log('Get your token from: https://www.notion.so/my-integrations');
        process.exit(1);
    }

    console.log('Testing Notion API integration...');
    
    try {
        const client = new NotionApiClient(token);
        
        // Test 1: Get databases
        console.log('\n1. Fetching databases...');
        const databases = await client.getDatabases();
        console.log(`Found ${databases.length} databases:`);
        databases.forEach(db => {
            console.log(`  - ${db.title} (${db.id})`);
        });

        if (databases.length === 0) {
            console.log('No databases found. Make sure your integration has access to some databases.');
            return;
        }

        // Test 2: Get first database details
        const firstDb = databases[0];
        console.log(`\n2. Getting details for database: ${firstDb.title}`);
        
        const dbDetails = await client.getDatabase(firstDb.id);
        console.log(`Database properties: ${Object.keys(dbDetails.properties).length} properties`);
        
        // Test 3: Get data sources
        console.log('\n3. Getting data sources...');
        const dataSources = await client.getDataSources(firstDb.id);
        console.log(`Found ${dataSources.length} data sources:`);
        dataSources.forEach(ds => {
            console.log(`  - ${ds.name} (${ds.id})`);
        });

        // Test 4: Get pages from first data source
        if (dataSources.length > 0) {
            console.log('\n4. Getting pages from first data source...');
            const pages = await client.getPagesFromDataSource(dataSources[0].id);
            console.log(`Found ${pages.length} pages:`);
            pages.slice(0, 3).forEach(page => {
                console.log(`  - ${page.title} (${page.id})`);
            });

            // Test 5: Convert first page to markdown
            if (pages.length > 0) {
                console.log('\n5. Converting first page to markdown...');
                const converter = new NotionToMarkdownConverter(client, 'attachments');
                const markdown = await converter.convertPage(pages[0].id);
                console.log('Markdown preview (first 200 chars):');
                console.log(markdown.substring(0, 200) + '...');
            }
        }

        // Test 6: Generate base file
        console.log('\n6. Generating base file...');
        const baseGenerator = new BaseGenerator();
        const baseContent = baseGenerator.generateBase(dbDetails, dataSources);
        console.log('Base file preview (first 200 chars):');
        console.log(baseContent.substring(0, 200) + '...');

        console.log('\n✅ All tests passed! The Notion API integration is working.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

// Run the test
testNotionApi().catch(console.error);
