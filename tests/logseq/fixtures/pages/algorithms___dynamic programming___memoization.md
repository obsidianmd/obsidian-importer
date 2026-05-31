- Memoization stores results of expensive function calls
- Back to ((d0000000-1111-2222-3333-444444444444))
- Example in code:
  - ```javascript
    function fib(n, memo = {}) {
      if (n <= 1) return n;
      if (memo[n]) return memo[n];
      return memo[n] = fib(n-1, memo) + fib(n-2, memo);
    }
    ```
