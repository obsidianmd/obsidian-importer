---
tags:
  - shell
  - after-fence
  - 1a
---
## Notes on the build

A real tag out here.

```sh
# not a heading, and #make is not a tag in here
grep -n '#define' main.c
```

Inline `#hashtag` stays where it is, and so does this:

    #indented code

A code span can cross a line ending: `inside
#multiline-code
still inside`.

~~~text
`
~~~
A backtick in a fence cannot hide this tag.
`

Issue #12 is a number, not a tag.

Wrapped in brackets it is left alone (#unclaimed), since `](#heading)` in a
link would otherwise read as one.
