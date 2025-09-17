# Links and Embeds Test File

This file is specifically designed to test various linking and embedding features in Obsidian.

## Internal Links

### Basic Links
- [[README]]
- [[Projects/Testing Framework]]
- [[Daily Notes/2023-01-01]]

### Links with Display Text
- [[README|Home Page]]
- [[Projects/Testing Framework|My Testing Project]]
- [[Daily Notes/2023-01-01|New Year's Day]]

### Links to Headings
- [[Complex Markdown Test File#Tables]]
- [[Projects/Testing Framework#Architecture]]
- [[README#Structure]]

### Block References
- [[Complex Markdown Test File^block-id]]
- [[README^introduction]]

### Non-existent Links
- [[Non-existent Note]]
- [[Fake Project/Imaginary File]]
- [[Missing File#Missing Section]]

## File Embeds

### Document Embeds
![[README]]
![[Projects/Testing Framework]]

### Partial Embeds
![[Complex Markdown Test File#Code Blocks]]
![[Projects/Testing Framework#Goals]]

### Block Embeds
![[Complex Markdown Test File^block-id]]

## Image Embeds

### Basic Images
![[test-image.png]]
![[folder/image.jpg]]

### Images with Size
![[test-image.png|300]]
![[large-image.jpg|500x300]]

### Images with Captions
![[chart.png|Chart showing test results]]
![[diagram.svg|System Architecture Diagram|400]]

## Attachment Embeds

### PDF Files
![[document.pdf]]
![[research-paper.pdf#page=5]]

### Audio Files
![[recording.mp3]]
![[music/song.wav]]

### Video Files
![[demo-video.mp4]]
![[tutorials/how-to.avi]]

## External Links

### Web Links
[Obsidian](https://obsidian.md)
[GitHub](https://github.com)
[Documentation](https://help.obsidian.md)

### Links with Titles
[Obsidian](https://obsidian.md "The knowledge management app")
[GitHub](https://github.com "Code hosting platform")

### Auto-links
https://obsidian.md
https://github.com/obsidianmd

## Link Variations

### Markdown Style Links to Internal Files
[README File](README.md)
[Testing Framework](Projects/Testing%20Framework.md)

### Wikilinks with Paths
[[folder/subfolder/file]]
[[../parent-folder/file]]
[[./same-folder/file]]

### Case Sensitivity Tests
[[readme]] (should link to README if case-insensitive)
[[README]] (exact case)
[[ReAdMe]] (mixed case)

## Complex Link Scenarios

### Links in Lists
1. First item with [[link to README]]
2. Second item with [[Projects/Testing Framework|project link]]
3. Third item with external [link](https://obsidian.md)

### Links in Tables
| File | Link | Type |
|------|------|------|
| Main | [[README]] | Internal |
| Project | [[Projects/Testing Framework]] | Internal |
| External | [Obsidian](https://obsidian.md) | External |

### Links in Quotes
> This quote contains a [[link to README]] and an external [link](https://obsidian.md).

### Links in Code Blocks
```
This code block mentions [[README]] but it shouldn't be a link.
Also mentions [Obsidian](https://obsidian.md) but it shouldn't work either.
```

### Inline Code Links
This paragraph has `[[README]]` in inline code, which shouldn't be a link.

## Broken Link Scenarios

### Missing Extensions
[[README.txt]] (wrong extension)
[[Projects/Testing Framework.pdf]] (wrong extension)

### Invalid Characters
[[file with | pipe]]
[[file with * asterisk]]
[[file with ? question]]

### Circular References
This file links to [[Links and Embeds Test File]] (itself)

## Edge Cases

### Empty Links
[[]]
![[]]

### Very Long Link Names
[[This is a very long link name that might cause issues with rendering or parsing in some systems and should be tested thoroughly]]

### Links with Special Characters
[[File with émojis 🎯]]
[[File with "quotes"]]
[[File with (parentheses)]]
[[File with [brackets]]]

### Multiple Links in Same Line
[[README]] and [[Projects/Testing Framework]] and [[Daily Notes/2023-01-01]]

### Nested Link Syntax
[[[README]]] (should this work?)
[[[[Projects/Testing Framework]]]] (what about this?)

## Tags as Links
#link-testing
#obsidian/links
#test-file

## Footnotes with Links
This is a footnote with a link[^1].

[^1]: See [[README]] for more information.

---

**Test Coverage:**
- ✅ Basic internal links
- ✅ Links with display text
- ✅ Links to headings
- ✅ Block references
- ✅ File embeds
- ✅ Image embeds
- ✅ External links
- ✅ Edge cases and error scenarios