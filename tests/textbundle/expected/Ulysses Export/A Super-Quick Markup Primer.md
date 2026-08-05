## A Super-Quick Markup Primer

As discussed in “First Steps”, Ulysses uses special characters around text passages to let you define the meaning of these passages. This is called “markup”, and each character set, such as _underscores for emphasis_, is called a “markup definition”. Any collection of definitions is then called a “markup language”. There are many markup languages in the wild, and you may have come across one or the other on message boards or blogging platforms: Textile, Setext, or the increasingly popular Markdown by John Gruber.

By default, Ulysses uses its native markup language, dubbed “Markdown XL”.


## Do You Speak Markdown XL?

If not, don’t worry – it is dead-easy to learn. Markdown XL consists of 25 definitions, and it will only take you little time to get the hang of it. Soon you will be able to just type away, with no need to reach for the mouse.

### The Smart Markup Bar

Until then, you can rely on Ulysses’ smart markup bar. Try and mark the word “rely”. Now, watch the bottom of the editor – see? The markup bar always displays the most common definitions for the specific selection, applicable with a single click.

The full list of available definitions is accessible via `⌘9`. In the markup panel, navigate with the arrow keys and press Return to apply a definition. You can also start typing to filter the definitions displayed in the panel.

The definitions work in three different ways: They either mark up an entire paragraph (e.g., Heading, Comment Block), or they mark up a word or a phrase (e.g., Strong, Marked), or they add a so-called text object (e.g., Link, Footnote).

Let’s have a quick run through all available definitions and their respective uses.


## The Writing Phase

To mark up a _title_, start a line with one hash (`#`), for a _heading_,  with two hashes (`##`). For a _subheading_, type three or more hashes  – the number of hashes corresponds to the subheading’s hierarchical level. 

If you want to _emphasize_ a word or phrase, or mark it up as **strong**, you can do so with single underscores or double asterisks, respectively, or use the shortcuts `⌘B` and `⌘I`.

_Dashed_ and _numbered lists_ can be created by simply typing dashes or numbers at the beginning of a line. And they will automatically continue, if “Smart Lists” are enabled in the Edit menu (“Edit › Substitutions”):

- This is
- An example
- Of a dashed list

If you want to create _ quotes_, e.g. to provide a motto, or to highlight famous quotes from even more famous people, simply start a line with a `>` character:

> That’s one small step for a man, one giant leap for mankind.
> (Neil Armstrong)

And with a _divider_ you can, well, divide. Text sections, for example.
---- 


## The Editing Phase

The next part of the markup is helpful for editing purposes: It lets you mark text, as you would with a classic highlighter, or indicate text for deletion. 


While these definitions serve important purposes on screen, their true power will only become apparent during export. As an example, when creating a PDF with the “Swiss Knife” style applied, comments and deletions will be absent from the output file, since this is a style meant to deliver a finalized PDF. But when using the “Rough Cut” style, comments will be included, since that style is meant to be used for printed drafts.

## Text Objects

Headings, emphasis and comments may be all that’s needed for general prose, but some texts require images or footnotes, and online publications may require the insertion of links.

Enter what we call text objects – “these colored bubbles” you have already come across in this introduction. They are a bit different from standard text markup, as you can double-click a text object and add additional content (a photo, a URL). Their creation, however, is just as simple:

To [add a link](https://ulysses.app), type square brackets around a word or phrase (or use the `⌘K` shortcut). This will open a popover which lets you add, well, a link to a webpage. If you type curly brackets around a phrase instead, you will create an annotation, which is basically a note added to that phrase. 

You can also add images or footnotes, again by typing only a few characters. [^1] Enter `(img)` and you’ll be asked to provide either an image file or a URL. Of course, you can also just drag an image into your text, but where’s the fun in that?

### Image Preview

Ulysses will, per default, display small image previews in the editor. You can tweak the size of this preview in Ulysses’ “General” preferences, or turn it off completely: Images will then be indicated by a little bubble dubbed `IMG`.


## The Geek’s Corner

Finally, there’s markup to either add `sample code` or raw source code. The former is indispensable for writing technical documentation, and the latter is really advanced stuff, with which you can add code that will be executed during export.

You can also insert whole paragraphs of both code variants. Here is a truly advanced Swift code example – released under GPL:

```swift
let myString = "You are beautiful."
print("Hello World. " + myString)
```

Note: If you indicate a programming language, the syntax of your code will be highlighted in the editor and relevant export formats.

And here is an example of a raw source block, which inserts a table when exported as HTML (and just vanishes when exported as PDF):

<table border="1">
 	<tr><th>City</th><th>Country</th><th>River</th></tr>
 	<tr><td>Hamburg</td><td>Hungary</td><td>Hérault</td></tr>
 	<tr><td>Leipzig</td><td>Latvia</td><td>Llobregat</td></tr>
</table>


[^1]:	Type (fn), put text into the popover, hit `⌘↩︎`, continue.