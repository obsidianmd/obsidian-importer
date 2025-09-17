/**
 * Obsidian Testing Toolkit - Test Data Manager
 *
 * Manages test data creation, sample vault generation, and test file management.
 * Provides utilities for creating realistic test scenarios and data sets.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { MockVault, MockTFile } from '../core/MockVault';
import { FileSystemMock } from './FileSystemMock';

/**
 * Configuration for test data generation
 */
export interface TestDataConfig {
  generateSampleVault?: boolean;
  sampleFiles?: string[];
  customFixtures?: Record<string, any>;
  templates?: Record<string, string>;
  seedData?: any;
}

/**
 * Sample file template
 */
export interface FileTemplate {
  path: string;
  content: string;
  frontmatter?: Record<string, any>;
  tags?: string[];
  links?: string[];
}

/**
 * Vault template for common scenarios
 */
export interface VaultTemplate {
  name: string;
  description: string;
  folders: string[];
  files: FileTemplate[];
  settings?: Record<string, any>;
}

/**
 * Test data manager for creating and managing test fixtures
 */
export class TestDataManager {
  private vault: MockVault;
  private fileSystem: FileSystemMock;
  private config: TestDataConfig;
  private templates: Map<string, VaultTemplate> = new Map();

  constructor(config: { vault: MockVault; fileSystem: FileSystemMock; config?: TestDataConfig }) {
    this.vault = config.vault;
    this.fileSystem = config.fileSystem;
    this.config = config.config || {};

    this.initializeTemplates();
  }

  /**
   * Create a sample file with realistic content
   */
  public async createSampleFile(path: string, template?: FileTemplate): Promise<MockTFile> {
    const fileTemplate = template || this.generateFileTemplate(path);
    const content = this.buildFileContent(fileTemplate);

    return await this.vault.create(path, content);
  }

  /**
   * Create multiple sample files
   */
  public async createSampleFiles(files: (string | FileTemplate)[]): Promise<MockTFile[]> {
    const createdFiles: MockTFile[] = [];

    for (const fileSpec of files) {
      if (typeof fileSpec === 'string') {
        createdFiles.push(await this.createSampleFile(fileSpec));
      } else {
        createdFiles.push(await this.createSampleFile(fileSpec.path, fileSpec));
      }
    }

    return createdFiles;
  }

  /**
   * Generate a complete vault from template
   */
  public async generateVaultFromTemplate(templateName: string): Promise<void> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found`);
    }

    // Create folders
    for (const folder of template.folders) {
      await this.vault.createFolder(folder);
    }

    // Create files
    for (const fileTemplate of template.files) {
      await this.createSampleFile(fileTemplate.path, fileTemplate);
    }
  }

  /**
   * Create a daily notes structure
   */
  public async createDailyNotesStructure(
    startDate: Date = new Date(),
    days: number = 30
  ): Promise<MockTFile[]> {
    const files: MockTFile[] = [];
    const dailyNotesFolder = 'Daily Notes';

    await this.vault.createFolder(dailyNotesFolder);

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      const dateString = date.toISOString().split('T')[0];
      const path = `${dailyNotesFolder}/${dateString}.md`;

      const content = this.generateDailyNoteContent(date, i);
      files.push(await this.vault.create(path, content));
    }

    return files;
  }

  /**
   * Create a project structure with tasks and notes
   */
  public async createProjectStructure(projectName: string): Promise<MockTFile[]> {
    const files: MockTFile[] = [];
    const projectFolder = `Projects/${projectName}`;

    await this.vault.createFolder('Projects');
    await this.vault.createFolder(projectFolder);
    await this.vault.createFolder(`${projectFolder}/Meeting Notes`);
    await this.vault.createFolder(`${projectFolder}/Resources`);

    // Main project file
    const projectContent = this.generateProjectContent(projectName);
    files.push(await this.vault.create(`${projectFolder}/${projectName}.md`, projectContent));

    // Tasks file
    const tasksContent = this.generateTasksContent(projectName);
    files.push(await this.vault.create(`${projectFolder}/Tasks.md`, tasksContent));

    // Meeting notes
    for (let i = 1; i <= 3; i++) {
      const meetingContent = this.generateMeetingNoteContent(projectName, i);
      files.push(await this.vault.create(`${projectFolder}/Meeting Notes/Meeting ${i}.md`, meetingContent));
    }

    // Resources
    const resourceContent = this.generateResourceContent(projectName);
    files.push(await this.vault.create(`${projectFolder}/Resources/Resources.md`, resourceContent));

    return files;
  }

  /**
   * Create a knowledge base structure
   */
  public async createKnowledgeBase(topics: string[]): Promise<MockTFile[]> {
    const files: MockTFile[] = [];

    await this.vault.createFolder('Knowledge Base');

    // Create MOC (Map of Content)
    const mocContent = this.generateMOCContent(topics);
    files.push(await this.vault.create('Knowledge Base/MOC.md', mocContent));

    // Create topic files
    for (const topic of topics) {
      const topicContent = this.generateTopicContent(topic, topics);
      files.push(await this.vault.create(`Knowledge Base/${topic}.md`, topicContent));
    }

    return files;
  }

  /**
   * Create test files with specific patterns
   */
  public async createTestPatterns(): Promise<MockTFile[]> {
    const files: MockTFile[] = [];

    // File with complex frontmatter
    const frontmatterFile = await this.vault.create('Test Files/Complex Frontmatter.md',
      this.generateComplexFrontmatterContent());
    files.push(frontmatterFile);

    // File with many links
    const linksFile = await this.vault.create('Test Files/Many Links.md',
      this.generateManyLinksContent());
    files.push(linksFile);

    // File with tags
    const tagsFile = await this.vault.create('Test Files/Many Tags.md',
      this.generateManyTagsContent());
    files.push(tagsFile);

    // File with embeds
    const embedsFile = await this.vault.create('Test Files/Embeds.md',
      this.generateEmbedsContent());
    files.push(embedsFile);

    // Large file
    const largeFile = await this.vault.create('Test Files/Large File.md',
      this.generateLargeFileContent());
    files.push(largeFile);

    return files;
  }

  /**
   * Create attachment files
   */
  public async createAttachments(): Promise<MockTFile[]> {
    const files: MockTFile[] = [];

    await this.vault.createFolder('Attachments');

    // Image files (mock)
    files.push(await this.vault.create('Attachments/image1.png', 'mock-image-data'));
    files.push(await this.vault.create('Attachments/image2.jpg', 'mock-image-data'));

    // PDF files (mock)
    files.push(await this.vault.create('Attachments/document.pdf', 'mock-pdf-data'));

    // Audio files (mock)
    files.push(await this.vault.create('Attachments/audio.mp3', 'mock-audio-data'));

    return files;
  }

  /**
   * Generate random markdown content
   */
  public generateRandomMarkdown(
    paragraphs: number = 3,
    includeHeadings: boolean = true,
    includeLists: boolean = true,
    includeLinks: boolean = true
  ): string {
    const content: string[] = [];

    if (includeHeadings) {
      content.push(`# ${this.getRandomTitle()}\n`);
    }

    for (let i = 0; i < paragraphs; i++) {
      if (includeHeadings && Math.random() > 0.7) {
        content.push(`## ${this.getRandomSubtitle()}\n`);
      }

      content.push(this.getRandomParagraph(includeLinks));
      content.push('');

      if (includeLists && Math.random() > 0.6) {
        content.push(this.getRandomList());
        content.push('');
      }
    }

    return content.join('\n');
  }

  /**
   * Clean up test data
   */
  public async cleanup(): Promise<void> {
    // This could be extended to clean up specific test files
    // For now, we rely on vault cleanup
  }

  /**
   * Get available templates
   */
  public getTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Add custom template
   */
  public addTemplate(name: string, template: VaultTemplate): void {
    this.templates.set(name, template);
  }

  /**
   * Initialize built-in templates
   */
  private initializeTemplates(): void {
    // Personal Knowledge Management template
    this.templates.set('pkm', {
      name: 'Personal Knowledge Management',
      description: 'A complete PKM setup with daily notes, projects, and knowledge base',
      folders: [
        'Daily Notes',
        'Projects',
        'Knowledge Base',
        'Templates',
        'Attachments',
        'Archive'
      ],
      files: [
        {
          path: 'README.md',
          content: '# My Knowledge Vault\n\nWelcome to my personal knowledge management system.',
          frontmatter: { created: new Date().toISOString() }
        },
        {
          path: 'Templates/Daily Note.md',
          content: '# {{date}}\n\n## Today\'s Focus\n\n## Notes\n\n## Tasks\n- [ ] \n\n## Reflections\n'
        }
      ]
    });

    // Academic Research template
    this.templates.set('research', {
      name: 'Academic Research',
      description: 'Setup for academic research with papers, notes, and citations',
      folders: [
        'Papers',
        'Literature Notes',
        'Permanent Notes',
        'Projects',
        'References'
      ],
      files: [
        {
          path: 'Papers/README.md',
          content: '# Research Papers\n\nCollection of academic papers and literature.'
        }
      ]
    });

    // Software Development template
    this.templates.set('development', {
      name: 'Software Development',
      description: 'Setup for software development notes and documentation',
      folders: [
        'Projects',
        'Learning Notes',
        'Code Snippets',
        'Documentation',
        'Meeting Notes'
      ],
      files: [
        {
          path: 'Projects/README.md',
          content: '# Development Projects\n\nTracking software development projects and progress.'
        }
      ]
    });
  }

  /**
   * Generate file template based on path
   */
  private generateFileTemplate(path: string): FileTemplate {
    const extension = path.split('.').pop();
    const basename = path.split('/').pop()?.replace(/\.[^.]*$/, '') || 'Untitled';

    if (extension === 'md') {
      return {
        path,
        content: this.generateRandomMarkdown(),
        frontmatter: {
          title: basename,
          created: new Date().toISOString(),
          tags: [this.getRandomTag()]
        }
      };
    }

    return {
      path,
      content: `# ${basename}\n\nContent for ${basename}`
    };
  }

  /**
   * Build file content from template
   */
  private buildFileContent(template: FileTemplate): string {
    const parts: string[] = [];

    // Add frontmatter if present
    if (template.frontmatter) {
      parts.push('---');
      for (const [key, value] of Object.entries(template.frontmatter)) {
        if (Array.isArray(value)) {
          parts.push(`${key}: [${value.map(v => `"${v}"`).join(', ')}]`);
        } else {
          parts.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
      parts.push('---');
      parts.push('');
    }

    // Add content
    parts.push(template.content);

    // Add tags if specified
    if (template.tags) {
      parts.push('');
      parts.push(template.tags.map(tag => `#${tag}`).join(' '));
    }

    return parts.join('\n');
  }

  /**
   * Generate daily note content
   */
  private generateDailyNoteContent(date: Date, dayIndex: number): string {
    const dateString = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `---
date: ${date.toISOString().split('T')[0]}
day: ${dayIndex + 1}
---

# ${dateString}

## Today's Focus
${this.getRandomFocus()}

## Notes
${this.getRandomParagraph(true)}

## Tasks
- [${Math.random() > 0.5 ? 'x' : ' '}] ${this.getRandomTask()}
- [${Math.random() > 0.5 ? 'x' : ' '}] ${this.getRandomTask()}
- [ ] ${this.getRandomTask()}

## Reflections
${this.getRandomReflection()}

#daily-note #${date.toISOString().split('T')[0].replace(/-/g, '/')}`;
  }

  /**
   * Generate project content
   */
  private generateProjectContent(projectName: string): string {
    return `---
title: ${projectName}
type: project
status: active
start_date: ${new Date().toISOString().split('T')[0]}
---

# ${projectName}

## Overview
${this.getRandomParagraph(false)}

## Goals
- ${this.getRandomGoal()}
- ${this.getRandomGoal()}
- ${this.getRandomGoal()}

## Timeline
- **Phase 1**: ${this.getRandomPhase()}
- **Phase 2**: ${this.getRandomPhase()}
- **Phase 3**: ${this.getRandomPhase()}

## Resources
- [[${projectName}/Resources]]
- [[${projectName}/Tasks]]

## Related
- [[Projects MOC]]

#project #${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * Generate various content helpers
   */
  private generateTasksContent(projectName: string): string {
    return `# ${projectName} - Tasks

## Backlog
- [ ] ${this.getRandomTask()}
- [ ] ${this.getRandomTask()}
- [ ] ${this.getRandomTask()}

## In Progress
- [ ] ${this.getRandomTask()}

## Done
- [x] ${this.getRandomTask()}
- [x] ${this.getRandomTask()}

[[${projectName}]]

#tasks #${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  }

  private generateMeetingNoteContent(projectName: string, meetingNumber: number): string {
    return `# ${projectName} - Meeting ${meetingNumber}

**Date**: ${new Date().toISOString().split('T')[0]}
**Attendees**: John Doe, Jane Smith

## Agenda
1. ${this.getRandomAgendaItem()}
2. ${this.getRandomAgendaItem()}
3. ${this.getRandomAgendaItem()}

## Notes
${this.getRandomParagraph(true)}

## Action Items
- [ ] ${this.getRandomActionItem()}
- [ ] ${this.getRandomActionItem()}

## Next Meeting
${this.getRandomNextSteps()}

[[${projectName}]]

#meeting #${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  }

  private generateComplexFrontmatterContent(): string {
    return `---
title: Complex Frontmatter Example
author: Test Author
date: ${new Date().toISOString()}
tags: [test, example, frontmatter]
categories:
  - Testing
  - Documentation
metadata:
  version: 1.0
  status: draft
  priority: high
aliases: ["Complex FM", "Frontmatter Test"]
publish: true
rating: 4.5
---

# Complex Frontmatter Example

This file demonstrates complex frontmatter usage.`;
  }

  private generateManyLinksContent(): string {
    const links = [
      '[[Daily Notes]]',
      '[[Projects/Project A]]',
      '[[Knowledge Base/Topic 1]]',
      '[[Knowledge Base/Topic 2]]',
      '[[Templates/Daily Note]]'
    ];

    return `# Many Links Example

This file contains many links: ${links.join(', ')}.

Here are some more links:
- ${links[0]}
- ${links[1]}
- ${links[2]}

And some with display text: [[${links[3].slice(2, -2)}|Custom Display Text]]`;
  }

  private generateManyTagsContent(): string {
    const tags = ['#tag1', '#tag2', '#tag3', '#nested/tag', '#category/subcategory'];
    return `# Many Tags Example

This file has many tags.

Some content here.

Tags: ${tags.join(' ')}`;
  }

  private generateEmbedsContent(): string {
    return `# Embeds Example

Here's an embedded image:
![[Attachments/image1.png]]

And an embedded note:
![[Knowledge Base/Topic 1]]

Code block embed:
![[Code Snippets/example.js]]`;
  }

  private generateLargeFileContent(): string {
    const content: string[] = ['# Large File Example\n'];

    for (let i = 0; i < 50; i++) {
      content.push(`## Section ${i + 1}`);
      content.push(this.getRandomParagraph(true));
      content.push(this.getRandomList());
      content.push('');
    }

    return content.join('\n');
  }

  // Random content generators
  private getRandomTitle(): string {
    const titles = ['Introduction', 'Overview', 'Analysis', 'Summary', 'Conclusion', 'Research', 'Study', 'Report'];
    return titles[Math.floor(Math.random() * titles.length)];
  }

  private getRandomSubtitle(): string {
    const subtitles = ['Background', 'Methodology', 'Results', 'Discussion', 'Key Points', 'Implementation'];
    return subtitles[Math.floor(Math.random() * subtitles.length)];
  }

  private getRandomParagraph(includeLinks: boolean = false): string {
    const sentences = [
      'This is a sample sentence for testing purposes.',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco.',
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.'
    ];

    const paragraph = sentences.slice(0, Math.floor(Math.random() * 3) + 2).join(' ');

    if (includeLinks && Math.random() > 0.5) {
      return paragraph + ' See also [[Related Note]] for more information.';
    }

    return paragraph;
  }

  private getRandomList(): string {
    const items = [
      'First item in the list',
      'Second important point',
      'Third consideration',
      'Additional note',
      'Final thought'
    ];

    const listItems = items.slice(0, Math.floor(Math.random() * 3) + 2);
    return listItems.map(item => `- ${item}`).join('\n');
  }

  private getRandomTag(): string {
    const tags = ['important', 'todo', 'research', 'personal', 'work', 'learning'];
    return tags[Math.floor(Math.random() * tags.length)];
  }

  private getRandomTask(): string {
    const tasks = [
      'Complete the analysis',
      'Review documentation',
      'Schedule follow-up meeting',
      'Update project status',
      'Send email to stakeholders'
    ];
    return tasks[Math.floor(Math.random() * tasks.length)];
  }

  private getRandomFocus(): string {
    const focuses = [
      'Complete project planning',
      'Review and analyze data',
      'Prepare presentation materials',
      'Conduct research',
      'Organize workspace'
    ];
    return focuses[Math.floor(Math.random() * focuses.length)];
  }

  private getRandomReflection(): string {
    const reflections = [
      'Today was productive and I made good progress.',
      'Encountered some challenges but found solutions.',
      'Need to focus more on prioritization tomorrow.',
      'Great collaboration with the team today.',
      'Learned something new and valuable.'
    ];
    return reflections[Math.floor(Math.random() * reflections.length)];
  }

  private getRandomGoal(): string {
    const goals = [
      'Increase efficiency by 20%',
      'Complete all deliverables on time',
      'Improve team collaboration',
      'Implement new processes',
      'Achieve project milestones'
    ];
    return goals[Math.floor(Math.random() * goals.length)];
  }

  private getRandomPhase(): string {
    const phases = [
      'Planning and requirements gathering',
      'Implementation and development',
      'Testing and validation',
      'Documentation and training',
      'Deployment and monitoring'
    ];
    return phases[Math.floor(Math.random() * phases.length)];
  }

  private getRandomAgendaItem(): string {
    const items = [
      'Project status update',
      'Review current blockers',
      'Discuss next steps',
      'Resource allocation',
      'Timeline adjustments'
    ];
    return items[Math.floor(Math.random() * items.length)];
  }

  private getRandomActionItem(): string {
    const items = [
      'Follow up with stakeholders',
      'Update documentation',
      'Schedule next review',
      'Implement feedback',
      'Prepare status report'
    ];
    return items[Math.floor(Math.random() * items.length)];
  }

  private getRandomNextSteps(): string {
    return 'Schedule for next week to review progress and plan upcoming milestones.';
  }

  private generateMOCContent(topics: string[]): string {
    const content = [`# Map of Content\n`];
    content.push('## Topics\n');

    topics.forEach(topic => {
      content.push(`- [[${topic}]]`);
    });

    content.push('\n## Categories\n');
    content.push('- #knowledge-management');

    return content.join('\n');
  }

  private generateTopicContent(topic: string, allTopics: string[]): string {
    const relatedTopics = allTopics.filter(t => t !== topic).slice(0, 2);

    return `# ${topic}

${this.getRandomParagraph(false)}

## Key Points

${this.getRandomList()}

## Related Topics

${relatedTopics.map(t => `- [[${t}]]`).join('\n')}

## References

- External reference 1
- External reference 2

#${topic.toLowerCase().replace(/\s+/g, '-')} #knowledge-base`;
  }

  private generateResourceContent(projectName: string): string {
    return `# ${projectName} - Resources

## Documentation
- [Project Documentation](https://example.com/docs)
- [API Reference](https://example.com/api)

## Tools
- Development Environment Setup
- Testing Framework
- Deployment Pipeline

## External Links
- [Relevant Article](https://example.com/article)
- [Best Practices Guide](https://example.com/guide)

[[${projectName}]]

#resources #${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  }
}