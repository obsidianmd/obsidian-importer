This page aims to test how different combinations of Notion text- and block-formatting are handled by Importer.

Some tests are very basic, but many have been added to demonstrate some very specific cases of formatting that are known to easily break during the conversion to Obsidian. Some formatting errors may break the entire page, whereas others may be subtle or go unnoticed — such as when a linebreak is inserted in slightly the wrong place, or bits of text disappear.

Ideally, this page should have near-identical formatting and structure when converted, bar any unsupported page/text elements. Also, the resulting Obsidian MD source should be readable and stylistically consistent in its own right.

Note: fixing one issue can cause a new issue or resurface an old one — keep checking previously resolved issues and add tests for new ones.

# Blocks, Line-breaks, Indents, Spacing

Check for the following issues:

- 1 Notion block → 1 Obsidian paragraph.
- 1 forced linebreak in a Notion block → 1 forced linebreak in an Obsidian paragraph.
- 2 forced linebreaks → 1 new Obsidian paragraph (identical to 2 linebreaks)
- 1 indented Notion text block → 1 regular paragraph in Obsidian
- If there is change in _**text formatting**_ anywhere after a forced linebreak, Notion adds an additional erroneous linebreak at the start of the _**formatting**_.  
    This is a bug and must be corrected by Importer.  
    
- The first text block within a Notion callout → callout title in Obsidian.
- 1 forced linebreak Notion callout title → 1 inline `<br>` tag in an Obsidian callout title.  
    Note: linebreaks should work as normal for all other nested text blocks in the callout.  
    
- When exported, Notion does not always encode the first line of callouts as a `<p>` element but as a raw `#text` node — this cause the title to concatenate with the next paragraph.  
    This must be corrected by importer.  
    
- Formatting applied across 2 lines in Notion → formatting applied to first line but terminated before linebreak; then reapplied after the linebreak, in Obsidian
- Duplicate text formatting should be removed by Importer.

The above rules should also apply when nested in callouts or quotes, unless stated otherwise.

---

A normal text block, equal to a single paragraph.

A text block, equal to a single paragraph but with a  
forced linebreak and **text-formatting here**.

A new text block with two consecutive forced linebreaks below—  
  
—still the same block down here, but equivalent to a new paragraph in Obsidian.  

An unindented text block, equal to a single paragraph.

An indented text bock, equal to a single new paragraph.

A further-indented text block, equal to a single new paragraph.

**This is all in bold but there’s a double line-break**  
  
**here that should be split apart.**  

> ~~Here is some continuously striken-out text~~  
> ~~with a sudden line-break right here,~~  
> ~~**and again right here but also with nested bold text!**~~
> 
> We have some more text here; let’s see if this has survived the formatting issues from above — we have contained this in a blockquote to stop the errors propagating to the rest of the file.

---

> First paragraph (text block) within this quote block; the same behaviour should apply as with non-quoted text.
> 
> A new paragraph within the quote block but with a  
> forced linebreak and **text-formatting here**.
> 
> A new text block with two consecutive forced linebreaks below—  
>   
> —still the same block down here, but equivalent to a new paragraph in Obsidian.  

> [!important] Title of the callout…<br>with a **linebreak** here.
> 
> This paragraph of the callout…  
> has a _**linebreak**_ here.
> 
> This paragraph of the callout…  
>   
> has a _**double**_ _**linebreak**_ here.

> [!important] _**A Formatted Callout Title**_
> 
> The formatting should work as normal within the title.

> [!important] Callout body with no title.

# Nested Formatting

### ==A Highlighted Heading==

==Here is some text that has been highlighted multiple times.==

# Quotes, Callouts + Nesting

It may be useful to encode Obsidian callouts as modified quote-blocks. We just need to check that the `[ ]` are not escaped after import.

---

> Here is a quote with lots of Nesting
> 
> First a nested block equation:
> 
> $$|x| = \begin{cases}  
> -x : & x \lt 0 \\  
> x : & x\ge 0  
> \end{cases}$$
> 
> > And a nested quote
> > 
> > > Inside a quote
> > > 
> > > > Inside a quote
> > > > 
> > > > > Inside a quote
> > > > > 
> > > > > _And more math:_
> > > > > 
> > > > > $$|x| = \begin{cases}  
> > > > > -x : & x \lt 0 \\  
> > > > > x : & x\ge 0  
> > > > > \end{cases}$$
> > > > 
> > > > _Truly incredible!_
> > > 
> > > Check that this has been de-nested correctly
> > 
> > And that it is separate from the following block.

> [!tip] Quote With `[!tip]` in Title
> 
> Adding `[!tip]` in a Notion quote creates an Obsidian callout
> 
> > [!tip] Nested Callout-Quote
> > 
> > We can do it again to nest!

> [!important] Title for Callout
> 
> Below we have a nested callout.
> 
> > [!important] Title for Nested Callout
> > 
> > Here is a new paragraph block in the nested callout!
> > 
> > > [!important] Title for Double-Nested Callout
> > > 
> > > Here is a new paragraph block in the double-nested callout!
> > > 
> > > Adding more nested math for fun:
> > > 
> > > $$|x| = \begin{cases}  
> > > -x : & x \lt 0 \\  
> > > x : & x\ge 0  
> > > \end{cases}$$
> > > 
> > > It should look pristine, even in source-editor mode.

# Lists + Nesting

- A level 1 list-item
    - Level 2 list-item
        - Level 3 list-item
        - Level 3 list-item, again
    - Level 2 list-item, again
        
        $$f(x)=e^z$$
        
        $$f(x)=e^x$$
        
- A level 1 list-item, again

# Hashtags

Hashtags have no special meaning in Notion; in Obsidian they create tags when followed by a series of characters that can contain:

- Alphanumeric characters: `[A-Za-z0-9]`
- Hyphens and underscores: `[-_]`
- Unicode `U0080` and above (Non-ASCII): `[^\x00-\x7F]`
- Backslashes for tag nesting: `/`

Note: there must be at least **one** non-numeric character in the tag.

---

The following are recognised as tags in Obsidian so **must be escaped** during import:

- \#123abc
- \#abc123
- \#-
- \#_
- \#/
- \#_123
- \#-123
- \#/123
- \#abc-123
- \#abc_123
- \#abc/123
- \#123/abc
- \#abc/def
- \#θανος
- \#§±_-123

The following are not recognised as tags, so **must not be escaped**:

- #123
- #+abc
- #=abc
- #.abc
- #\abc
- `#abc`
- Display code block:
    
    ```Plain
    \#abc
    ```
    

The following are already escaped for special syntax _eg_ for math or links to headers, so **must not be escaped twice** or the blocks will break:

- $x=a\#b$
- Display math block:
    
    $$x = \begin{cases}  
    a\#b &: x<0 \\  
    0 &: x\ge0  
    \end{cases}$$
    
- An internal link to a previous heading: .

  

# Mathematical Equations

## Math in Callouts

Below is a callout showing a mathematical function.

> [!important] Title for Callout
> 
> This paragraph block is about the complex exponential function:
> 
> $$f(t)=Ae^{i\omega t},$$
> 
> where $t$ is time.

> [!important] Title for Multiline Math Nested in Callout
> 
> This paragraph block is about the complex exponential function:
> 
> $$\begin{align}  
> f(t) &=Ae^{i\omega t} \\  
> g(t) &= Be^{i\sigma t},  
> \end{align}$$
> 
> where $t$ is time. And $f(x) = g(x)$ when $\small A= B = \begin{cases} 1:x>0 \\ 0:x<0 \end{cases}$.

## Math in Text

The complex exponential function is

$$f(t)=Ae^{i\omega t},$$

where $t$ is time.

## Math with Cases

Here is the definition for the absolute value function:

$$|x| = \begin{cases}  
-x : & x \lt 0 \\  
x : & x\ge 0  
\end{cases}$$

## Math with Trailing Spaces & Linebreaks

- Leading/trailing spaces are not an issue in Notion, but they must be removed when converting to Obsidian.
- Linebreaks can be an issue within inline math, especially when nested.
- Double linebreaks can be an issue within display math, especially when nested.

---

1. $f(x)$ has no trailing spaces: `$f(x)$`.
2. $g(x)$ has two trailing spaces: `$ g(x) $`.
3. $h(x)$ has an escaped trailing space: `$h(x)\ $`.
4. $p(x) = e^{x}$ has trailing linebreaks: `$<br><br>p(x) = e^{x}<br><br>$`.

Multiline display math with trailing space:

```LaTeX
$$  \ \\\mathrm{abs}(x)=|x|
=\begin{cases} 
-x : & x \lt 0 \\
x  : & x\ge 0
\end{cases}\\
\      
   $$
```

$$\mathrm{abs}(x)=|x|  
=\begin{cases}  
-x : & x \lt 0 \\  
x : & x\ge 0  
\end{cases}$$

## Math With # Variables

Here is a complicated looking bit of math that uses a `#` variable in a user-defined command:

$$\renewcommand{\vec}[1]{\boldsymbol{#1}}  
\begin{align*}  
\vec{\dot v}_\alpha &=  
\vec f_\alpha (t) + \vec\xi_\alpha(t)  
\\  
\vec f_\alpha (t) &=  
{1\over\tau_\alpha} (\vec{ \bar v}_\alpha -  
\vec v_\alpha) +  
\sum_{\beta≠\alpha}\vec f_{\alpha\beta}(t) +  
\sum_{i}\vec f_{\alpha i}(t)  
\end{align*}$$

# Internal Links

Currently, Notion does not export standalone internal links to headings or blocks, only standalone links to other pages, or links within table of contents. This appears to be a bug.

---

Link to heading:

[[Formatting Tests]]

Link to text block:

[[Formatting Tests]]

---

Link to a another page: [[Block Reference]]

Link to heading in another page:

Link to text block in another page: