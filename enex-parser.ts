import * as flow from 'xml-flow';
import * as fs from 'fs';


let inFile = fs.createReadStream('./your-xml-file.xml')
let xmlStream = flow(inFile);

