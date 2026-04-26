// Prepend #!/usr/bin/env node shebang to dist/cli/main.js after tsup build
import fs from 'node:fs';
const f = 'dist/cli/main.js';
const content = fs.readFileSync(f, 'utf-8');
if (!content.startsWith('#!')) {
  fs.writeFileSync(f, '#!/usr/bin/env node\n' + content, 'utf-8');
  console.log('Added shebang to dist/cli/main.js');
}
