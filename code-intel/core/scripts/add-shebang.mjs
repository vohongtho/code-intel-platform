// Prepend #!/usr/bin/env node shebang to dist/cli/main.js and dist/cli/hook.js after tsup build
import fs from 'node:fs';

for (const f of ['dist/cli/main.js', 'dist/cli/hook.js']) {
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf-8');
  if (!content.startsWith('#!')) {
    fs.writeFileSync(f, '#!/usr/bin/env node\n' + content, 'utf-8');
    console.log(`Added shebang to ${f}`);
  }
}
