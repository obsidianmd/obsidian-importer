- You can include code in different programming languages in Roam, for example
    - JS block
        - ```javascript
          <!DOCTYPE HTML>
          <html>

          <body>

            <p>Before the script...</p>

            <script>
              alert( 'Hello, Roamans!' );
            </script>

            <p>...After the script.</p>

          </body>

          </html>```
    - CSS block
        - ```css
          <style type="text/css">
          h1 {
          	color: DeepSkyBlue;
          }
          </style>

          <h1>Hello, Roamans!</h1>```
    - Clojure block
        - ```clojure
          (ns hello-world.core)

          (println "Hello Roamans!")```
- Key Commands:
    - `/code block`