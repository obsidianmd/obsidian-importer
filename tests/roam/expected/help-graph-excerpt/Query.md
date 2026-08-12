- # Types of queries
    - ### and
        - Find all blocks matching multiple conditions – i.e. blocks or their parents containing multiple page or block references.
        - `{{query: {and: [[page A]] [[page B]] }}}
          {{query: {and: [[articles]] ((block)) }}}
          {{query: {and: [[Chris Lee]] ((block)) [[econ]] }}}
          `
    - ### or
        - Find all blocks matching any of a number of conditions – i.e. blocks or their parents containing any of the selected page or block references.

        - `{{query: {or: [[page A]] [[page B]] }}}
          {{query: {or: [[Zen]] [[Buddhism]] }}}
          {{query: {or: [[Utah]] [[Idaho]] [[Montana]] }}}
          `
    - ### not
        - Exclude blocks matching any of the page or block references selected.
        - `{{query: {and: [[page A]] {not: [[page B]] }}}}
          {{query: {and: [[Slate Star Codex]] {not: [[psychiatry]] }}}}`
    - ### between
        - Finds all blocks on daily pages and blocks mentioning a date between two days. ==**This only works on Daily Notes page**==.
        - You can use the following as a shorthand: [[today]], [[tomorrow]], [[yesterday]], [[last week]], [[next week]], [[last month]], and [[next month]]. 
        - `{{query: {between: [[2021-01-01]] [[today]] }}
          {{query: {and: [[mistakes]] {between: [[2020-01-01]] [[2020-12-31]] }}}}
          {{query: {and: [[TODO]] {between: [[last week]] [[today]] }}}}`
- ## Community Videos::
    - ### Query syntax and logic: how to ask Roam questions with queries by [[Sam Patel]]
        - ![](https://www.youtube.com/watch?v=EXAMPLE0001&t=20s&ab_channel=RobertHaisfield)
    - ### How Queries Work in Roam Research by [[R.J. Nestor]]
        - ![](https://www.youtube.com/watch?v=EXAMPLE0001)
    - ### Roam Research Search Queries by [[Alex Rivera]]
        - ![](https://www.youtube.com/watch?v=EXAMPLE0001)
    - ### Insight Hunting with Queries in Roam by [[Example Studio]]
        - ![](https://www.youtube.com/watch?v=EXAMPLE0001)
    - ### Roam Research Query Tutorial: Pending Tasks for Task Management and Task Dashboard Using Queries by [[The Upgraded Brain]]
        - ![](https://www.youtube.com/watch?v=EXAMPLE0001)
- ## Articles::
    - ### [How to query in Roam](https://roamhacks.com/how-to-query-roam/) by [[Roamhacks]]
    - ### [Searching Roam With Queries: A Primer](https://www.roamstack.com/roam-queries-primer/) by [[RoamStack]]
- ## Key Commands::
    - `/query`