#!/bin/bash

# Exit on error
set -e

# Build the project
echo "Building project..."
npm run build

# Define target directory
TARGET_DIR="$OV2024/.obsidian/plugins/obsidian-importer"

# Create target directory if it doesn't exist
echo "Creating target directory if it doesn't exist..."
mkdir -p "$TARGET_DIR"

# Copy necessary files
echo "Copying files to $TARGET_DIR..."
cp main.js "$TARGET_DIR/"
cp manifest.json "$TARGET_DIR/"
cp styles.css "$TARGET_DIR/"

echo "Deployment complete! Please restart Obsidian to load the updated plugin." 