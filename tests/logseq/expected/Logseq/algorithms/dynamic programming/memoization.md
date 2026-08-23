---
logseq-source: Fixture graph/pages/algorithms___dynamic programming___memoization.md
---
- Memoization stores results of expensive function calls
- Back to [[Logseq/algorithms/dynamic programming#^d00000]]
- Example in code:
  - ```javascript
    function fib(n, memo = {}) {
      if (n <= 1) return n;
      if (memo[n]) return memo[n];
      return memo[n] = fib(n-1, memo) + fib(n-2, memo);
    }
    ```

