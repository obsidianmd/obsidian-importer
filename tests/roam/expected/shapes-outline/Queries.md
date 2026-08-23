- ```query
  block:([[Sapiens]] [[Dune]])
  ```
- ```query
  block:([[Sapiens]] OR [[Dune]])
  ```
- ```query
  block:([[Sapiens]] (-[[Dune]]))
  ```
- ```query
  block:(#history ([[Sapiens]] OR [[Dune]]))
  ```
- {{query: {between: [[2021-01-01]] [[today]]}}}
- Written as an example: `{{query: {and: [[A]] [[B]]}}}`