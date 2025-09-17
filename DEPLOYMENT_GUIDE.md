# Deployment Guide - Obsidian Importer

This guide provides comprehensive instructions for installing, deploying, and contributing to the Obsidian Importer plugin.

## Table of Contents

1. [Installation Methods](#installation-methods)
2. [Manual Installation](#manual-installation)
3. [Development Setup](#development-setup)
4. [Contributing Guidelines](#contributing-guidelines)
5. [Build Process](#build-process)
6. [Release Management](#release-management)
7. [Testing Guidelines](#testing-guidelines)
8. [Issue Reporting](#issue-reporting)

## Installation Methods

### Method 1: Community Plugins (Recommended for Users)

This is the easiest method for end users:

1. **Open Obsidian**
2. **Navigate to Settings**:
   - Click the Settings icon (⚙️) in the bottom-left corner
   - Or use the keyboard shortcut: `Ctrl/Cmd + ,`

3. **Access Community Plugins**:
   - Go to **Settings** → **Community Plugins**
   - Ensure **Safe mode** is turned OFF
   - If Safe mode is ON, click **Turn off Safe mode**

4. **Browse and Install**:
   - Click **Browse** community plugins
   - Search for "Importer" or "obsidian-importer"
   - Click **Install** on the "Importer" plugin by Obsidian
   - Once installed, click **Enable**

5. **Verify Installation**:
   - Open Command Palette (`Ctrl/Cmd + P`)
   - Type "Import" and look for "Importer: Open"
   - The plugin is successfully installed if this command appears

### Method 2: Direct Download (Community Plugin)

If you prefer to download directly:

1. **Download Latest Release**:
   - Visit [Obsidian Community Plugins](https://obsidian.md/plugins?id=obsidian-importer)
   - Click **Install** to automatically add to Obsidian

2. **Enable Plugin**:
   - Go to **Settings** → **Community Plugins**
   - Find "Importer" in the **Installed plugins** list
   - Toggle it **ON**

## Manual Installation

For developers or users who want to install manually:

### Prerequisites

- Obsidian installed on your system
- Basic understanding of file system navigation
- Administrative access (for some systems)

### Installation Steps

1. **Locate Obsidian Plugins Directory**:

   **Windows**:
   ```
   %APPDATA%\Obsidian\YourVaultName\.obsidian\plugins\
   ```

   **macOS**:
   ```
   ~/Library/Application Support/obsidian/YourVaultName/.obsidian/plugins/
   ```

   **Linux**:
   ```
   ~/.config/obsidian/YourVaultName/.obsidian/plugins/
   ```

2. **Create Plugin Directory**:
   ```bash
   mkdir obsidian-importer
   cd obsidian-importer
   ```

3. **Download Required Files**:
   Download these files from the [latest release](https://github.com/obsidianmd/obsidian-importer/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css` (if available)

4. **Place Files in Directory**:
   ```
   YourVault/.obsidian/plugins/obsidian-importer/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

5. **Restart Obsidian**:
   - Close Obsidian completely
   - Reopen Obsidian
   - Go to **Settings** → **Community Plugins**
   - Find "Importer" and enable it

### Verification

1. **Check Plugin Status**:
   - Go to **Settings** → **Community Plugins**
   - Verify "Importer" appears in the installed plugins list
   - Ensure it's enabled (toggle should be ON)

2. **Test Functionality**:
   - Open Command Palette (`Ctrl/Cmd + P`)
   - Type "Importer" and select "Importer: Open"
   - The import dialog should appear

## Development Setup

For developers who want to contribute or modify the plugin:

### Prerequisites

- **Node.js**: Version 16 or higher
- **npm**: Latest version
- **Git**: For version control
- **TypeScript**: Familiarity recommended
- **Obsidian**: For testing

### Setup Process

1. **Clone Repository**:
   ```bash
   git clone https://github.com/obsidianmd/obsidian-importer.git
   cd obsidian-importer
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Development Commands**:
   ```bash
   # Start development build with watch mode
   npm run dev

   # Build for production
   npm run build

   # Run linter
   npm run lint

   # Run linter with auto-fix
   npm run lint -- --fix
   ```

4. **Link to Obsidian Vault** (for testing):
   ```bash
   # Create symbolic link to your test vault
   ln -s /path/to/obsidian-importer /path/to/your/vault/.obsidian/plugins/obsidian-importer
   ```

5. **Development Workflow**:
   - Make changes to source files in `src/`
   - Run `npm run dev` for development builds
   - Test in Obsidian by reloading the plugin
   - Use Obsidian's Developer Console (`Ctrl/Cmd + Shift + I`) for debugging

## Contributing Guidelines

We welcome contributions! Here's how to get started:

### Types of Contributions

1. **Bug Fixes**: Fix existing issues
2. **New Import Formats**: Add support for new apps/formats
3. **Feature Enhancements**: Improve existing functionality
4. **Documentation**: Improve guides and help content
5. **Testing**: Write tests and report bugs

### Before Contributing

1. **Check Existing Issues**:
   - Browse [GitHub Issues](https://github.com/obsidianmd/obsidian-importer/issues)
   - Look for issues tagged with `help wanted` or `good first issue`
   - Check if your idea is already being discussed

2. **Read Documentation**:
   - Review the [Contributing Guidelines](CONTRIBUTING.md)
   - Understand the codebase structure
   - Check coding standards and style guide

### Contribution Process

1. **Fork the Repository**:
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/yourusername/obsidian-importer.git
   cd obsidian-importer
   ```

2. **Create Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Make Changes**:
   - Follow the existing code style
   - Add appropriate tests
   - Update documentation if needed
   - Ensure linting passes: `npm run lint`

4. **Test Your Changes**:
   - Build the plugin: `npm run build`
   - Test in Obsidian manually
   - Ensure all existing functionality still works

5. **Commit and Push**:
   ```bash
   git add .
   git commit -m "Add: Description of your changes"
   git push origin feature/your-feature-name
   ```

6. **Create Pull Request**:
   - Go to GitHub and create a pull request
   - Provide clear description of changes
   - Include screenshots if relevant
   - Reference any related issues

### Code Style Guidelines

- **TypeScript**: Use TypeScript for all new code
- **ESLint**: Follow existing linting rules
- **Formatting**: Use consistent indentation and formatting
- **Comments**: Add clear comments for complex logic
- **Error Handling**: Include proper error handling and user feedback

## Build Process

### Development Build

```bash
# Start development server with file watching
npm run dev
```

This will:
- Compile TypeScript to JavaScript
- Bundle all dependencies
- Watch for file changes
- Output `main.js` for testing

### Production Build

```bash
# Create production build
npm run build
```

This will:
- Compile and optimize all code
- Create minified `main.js`
- Generate source maps
- Prepare for distribution

### Build Output

The build process creates these files:
- `main.js`: Main plugin code (bundled and minified)
- `manifest.json`: Plugin metadata
- `styles.css`: Plugin styles (if applicable)

### Build Verification

```bash
# Check build integrity
file main.js
ls -la main.js manifest.json styles.css

# Verify versions match
grep version manifest.json package.json
```

## Release Management

### Version Management

The plugin uses semantic versioning:
- **Major** (X.0.0): Breaking changes
- **Minor** (X.Y.0): New features, backward compatible
- **Patch** (X.Y.Z): Bug fixes, backward compatible

### Release Process

1. **Update Version Numbers**:
   ```bash
   # Update package.json, manifest.json, and versions.json
   npm run version
   ```

2. **Build Release**:
   ```bash
   npm run build
   ```

3. **Create Release Package**:
   ```bash
   # Copy essential files to release directory
   mkdir -p release
   cp main.js manifest.json styles.css release/
   ```

4. **Test Release**:
   - Install in test vault
   - Verify all functionality
   - Check compatibility

5. **Create GitHub Release**:
   - Tag the version: `git tag v1.7.0`
   - Push tags: `git push --tags`
   - Create release on GitHub
   - Upload release files

### Release Checklist

- [ ] Version numbers updated in all files
- [ ] CHANGELOG.md updated
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Release notes prepared
- [ ] Backward compatibility verified

## Testing Guidelines

### Manual Testing

1. **Installation Testing**:
   - Test fresh installation
   - Test update from previous version
   - Verify on different platforms

2. **Import Testing**:
   - Test each supported format
   - Test with various file sizes
   - Test error conditions
   - Verify output quality

3. **Integration Testing**:
   - Test with other plugins
   - Test on different vault structures
   - Test mobile compatibility

### Automated Testing

```bash
# Run linting
npm run lint

# Check TypeScript compilation
npx tsc --noEmit --skipLibCheck

# Build verification
npm run build && node -e "console.log(require('./package.json').version)"
```

### Test Environments

- **Desktop**: Windows, macOS, Linux
- **Mobile**: iOS, Android (if supported)
- **Obsidian Versions**: Current and previous major versions

## Issue Reporting

### Before Reporting

1. **Search Existing Issues**: Check if the issue already exists
2. **Update Plugin**: Ensure you're using the latest version
3. **Test in Safe Mode**: Disable other plugins to isolate the issue
4. **Gather Information**: Collect relevant details

### Creating Good Bug Reports

Include these details:

1. **Environment**:
   - Obsidian version
   - Plugin version
   - Operating system
   - Other active plugins

2. **Steps to Reproduce**:
   - Clear, numbered steps
   - Expected behavior
   - Actual behavior

3. **Additional Context**:
   - Screenshots or videos
   - Sample files (if safe to share)
   - Console error messages
   - Any workarounds found

### Issue Template

```markdown
**Environment:**
- Obsidian version:
- Plugin version:
- OS:

**Description:**
Brief description of the issue

**Steps to Reproduce:**
1.
2.
3.

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Additional Context:**
- Console errors:
- Screenshots:
- Sample files:
```

### Feature Requests

For feature requests:
1. **Check Existing Requests**: Avoid duplicates
2. **Provide Use Case**: Explain why the feature is needed
3. **Suggest Implementation**: If you have ideas
4. **Consider Scope**: Ensure it fits the plugin's purpose

## Support and Resources

### Getting Help

1. **Documentation**: Read the [User Guide](docs/USER_GUIDE.md)
2. **Community Forum**: [Obsidian Forum](https://forum.obsidian.md)
3. **Discord**: Obsidian Discord server
4. **GitHub Issues**: For bugs and feature requests

### Useful Links

- **GitHub Repository**: https://github.com/obsidianmd/obsidian-importer
- **Obsidian Plugin Guidelines**: https://docs.obsidian.md/Plugins/Getting+started/Plugin+guidelines
- **Obsidian API Documentation**: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- **Community Forum**: https://forum.obsidian.md

### Development Resources

- **TypeScript Handbook**: https://www.typescriptlang.org/docs/
- **Node.js Documentation**: https://nodejs.org/docs/
- **ESLint Rules**: https://eslint.org/docs/rules/
- **Obsidian API Types**: Available in the `obsidian` package

## Conclusion

This deployment guide covers all aspects of installing, developing, and contributing to the Obsidian Importer plugin. Whether you're an end user looking to install the plugin or a developer wanting to contribute, this guide provides the necessary information to get started.

For the most up-to-date information, always refer to the [GitHub repository](https://github.com/obsidianmd/obsidian-importer) and the official Obsidian documentation.

Happy importing and contributing!