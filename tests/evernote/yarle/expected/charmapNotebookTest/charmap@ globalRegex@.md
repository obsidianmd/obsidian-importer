---
---
Charactermap:

{
  "|": "--",
  "#": "\*",
  "^": "\*",
  "@": "!",
}

Global Regexp on title:
{
    "type": "title",
    "regex": "\[@\]",
    "replace": "!"
  },

  {
    "type": "title",
    "regex": "\[#\]",
    "replace": "\\\*"
  },
