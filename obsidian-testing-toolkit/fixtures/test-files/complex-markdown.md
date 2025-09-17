---
title: Complex Markdown Test File
author: Test Suite
date: 2023-01-15T10:00:00Z
tags: [testing, markdown, complex]
categories:
  - Testing
  - Documentation
metadata:
  version: 1.0
  complexity: high
  features:
    - frontmatter
    - links
    - embeds
    - code
    - tables
    - lists
aliases: ["Complex MD", "Test File"]
publish: true
rating: 4.5
custom_field: "This is a custom field for testing"
---

# Complex Markdown Test File

This file contains various Markdown features for comprehensive testing of parsing and rendering capabilities.

## Table of Contents
- [[#Frontmatter Testing]]
- [[#Links and References]]
- [[#Code Blocks]]
- [[#Tables]]
- [[#Lists]]
- [[#Embeds]]
- [[#Math]]
- [[#Special Characters]]

## Frontmatter Testing

The frontmatter above contains various data types:
- Strings
- Numbers
- Booleans
- Arrays
- Objects
- Dates

## Links and References

### Internal Links
- [[README]] - Simple internal link
- [[Projects/Testing Framework]] - Link with path
- [[Projects/Testing Framework|Custom Display Text]] - Link with custom text
- [[Daily Notes/2023-01-01#Today's Focus]] - Link to heading
- [[Complex Markdown Test File^block-id]] - Block reference

### External Links
- [Obsidian](https://obsidian.md) - External website
- [GitHub Repo](https://github.com/obsidianmd/obsidian-api) - External repo

### Block References
This is a paragraph that can be referenced. ^block-id

Here's another block with an ID for testing. ^another-block

## Code Blocks

### Inline Code
Here's some `inline code` in a sentence.

### Code Blocks with Language

```javascript
// JavaScript example
function testFunction(param) {
    const result = param * 2;
    console.log(`Result: ${result}`);
    return result;
}

// Test the function
testFunction(42);
```

```python
# Python example
def fibonacci(n):
    """Generate Fibonacci sequence up to n terms."""
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]

    sequence = [0, 1]
    for i in range(2, n):
        sequence.append(sequence[i-1] + sequence[i-2])

    return sequence

# Test the function
print(fibonacci(10))
```

```typescript
// TypeScript example
interface User {
    id: number;
    name: string;
    email?: string;
}

class UserManager {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }

    findUser(id: number): User | undefined {
        return this.users.find(user => user.id === id);
    }
}
```

### Code Block Without Language
```
This is a code block without language specification.
It should still be properly formatted.
Lines should maintain their structure.
```

## Tables

### Simple Table
| Name | Age | City |
|------|-----|------|
| Alice | 30 | New York |
| Bob | 25 | London |
| Charlie | 35 | Tokyo |

### Complex Table
| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| **Frontmatter** | ✅ Complete | High | All data types supported |
| **Links** | 🔄 In Progress | High | Block references pending |
| **Embeds** | ⏳ Planned | Medium | Images and files |
| **Math** | ❌ Not Started | Low | LaTeX support |

### Table with Alignment
| Left Aligned | Center Aligned | Right Aligned |
|:-------------|:--------------:|--------------:|
| Text | Text | Text |
| More text | More text | More text |
| Even more | Even more | Even more |

## Lists

### Unordered Lists
- First level item
- Another first level item
  - Second level item
  - Another second level item
    - Third level item
    - Another third level item
- Back to first level

### Ordered Lists
1. First numbered item
2. Second numbered item
   1. Nested numbered item
   2. Another nested item
      1. Deeply nested item
      2. Another deeply nested item
3. Back to top level

### Mixed Lists
1. Numbered item with nested unordered list:
   - Bullet point
   - Another bullet point
2. Another numbered item
   - More bullet points
     1. Nested numbered in bullet
     2. Another nested numbered
3. Final numbered item

### Task Lists
- [x] Completed task
- [x] Another completed task
- [ ] Incomplete task
- [ ] Another incomplete task
  - [x] Nested completed subtask
  - [ ] Nested incomplete subtask
- [x] Task with **bold** text
- [ ] Task with [[link]] in it

## Embeds

### Image Embeds
![[test-image.png]]
![[Images/another-image.jpg|Custom Caption]]
![[Documents/chart.svg|500]]

### File Embeds
![[Documents/important-document.pdf]]
![[Audio/recording.mp3]]

### Note Embeds
![[README]]
![[Projects/Testing Framework#Architecture]]

## Math

### Inline Math
The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

The area of a circle is $A = \pi r^2$.

### Block Math
$$
\begin{align}
\nabla \times \vec{\mathbf{B}} -\, \frac1c\, \frac{\partial\vec{\mathbf{E}}}{\partial t} &= \frac{4\pi}{c}\vec{\mathbf{j}} \\
\nabla \cdot \vec{\mathbf{E}} &= 4 \pi \rho \\
\nabla \times \vec{\mathbf{E}}\, +\, \frac1c\, \frac{\partial\vec{\mathbf{B}}}{\partial t} &= \vec{\mathbf{0}} \\
\nabla \cdot \vec{\mathbf{B}} &= 0
\end{align}
$$

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

## Special Characters

### Escaping
\*This text is not italic\*
\`This is not code\`
\#This is not a heading

### Unicode
- Arrows: → ← ↑ ↓ ⇒ ⇐ ⇑ ⇓
- Math: ∑ ∏ ∫ ∞ ± ≠ ≤ ≥ ≈ ≡
- Greek: α β γ δ ε θ λ μ π σ φ ψ ω
- Symbols: ★ ✓ ✗ ♠ ♣ ♥ ♦ © ® ™

### Emojis
🎯 🚀 📊 💡 🔬 📚 ⚡ 🎨 🌟 🔥

## Formatting

### Text Formatting
- **Bold text**
- *Italic text*
- ***Bold and italic***
- ~~Strikethrough~~
- ==Highlighted text==
- `Inline code`

### Combinations
- **Bold with *nested italic* text**
- *Italic with **nested bold** text*
- ==Highlighted with **bold** and *italic*==
- ~~Strikethrough with **bold** text~~

## Quotes

### Blockquotes
> This is a simple blockquote.

> This is a blockquote
> that spans multiple lines
> and maintains formatting.

> **Blockquote with formatting**
>
> - Can contain lists
> - And other elements
>
> > Nested blockquotes are also possible
> > And they work as expected

### Callouts
> [!NOTE]
> This is a note callout with important information.

> [!WARNING]
> This is a warning callout that highlights potential issues.

> [!TIP]
> This is a tip callout with helpful suggestions.

## Horizontal Rules

---

***

___

## Comments
<!-- This is a comment and should not be visible -->
%%This is an Obsidian comment%%

## Footnotes

This text has a footnote[^1].

Here's another footnote reference[^note].

[^1]: This is the first footnote.
[^note]: This is a named footnote.

## Tags

Tags can appear anywhere in the document:

#test-file #markdown #complex #comprehensive #features

Nested tags: #testing/unit #testing/integration

## Conclusion

This file demonstrates various Markdown features and Obsidian-specific syntax for comprehensive testing of parsing, rendering, and linking capabilities.

---

**Generated**: 2023-01-15 by Testing Suite
**Purpose**: Comprehensive Markdown feature testing
**Status**: Complete