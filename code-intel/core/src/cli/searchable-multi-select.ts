interface Choice {
  name: string;
  value: string;
  description?: string;
  preSelected?: boolean;
}

interface Config {
  message: string;
  choices: Choice[];
  pageSize?: number;
  validate?: (selected: string[]) => boolean | string;
}

const ansi = {
  dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[39m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[39m`,
  green: (text: string) => `\x1b[32m${text}\x1b[39m`,
  red: (text: string) => `\x1b[31m${text}\x1b[39m`,
  inverse: (text: string) => `\x1b[7m${text}\x1b[27m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

async function createSearchableMultiSelect(): Promise<(config: Config) => Promise<string[]>> {
  const {
    createPrompt,
    useState,
    useKeypress,
    useMemo,
    usePrefix,
    isEnterKey,
    isBackspaceKey,
    isUpKey,
    isDownKey,
  } = await import('@inquirer/core');

  return createPrompt((config: Config, done: (value: string[]) => void): string => {
    const { message, choices, pageSize = 15, validate } = config;

    const [searchText, setSearchText] = useState('');
    const [selectedValues, setSelectedValues] = useState<string[]>(
      () => choices.filter((choice) => choice.preSelected).map((choice) => choice.value),
    );
    const [cursor, setCursor] = useState(0);
    const [status, setStatus] = useState<'idle' | 'done'>('idle');
    const [error, setError] = useState<string | null>(null);

    const prefix = usePrefix({ status });

    const filteredChoices = useMemo(() => {
      if (!searchText.trim()) return choices;
      const term = searchText.toLowerCase();
      return choices.filter(
        (choice) =>
          choice.name.toLowerCase().includes(term) ||
          choice.value.toLowerCase().includes(term) ||
          choice.description?.toLowerCase().includes(term),
      );
    }, [searchText, choices]);

    const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
    const choiceMap = useMemo(() => new Map(choices.map((choice) => [choice.value, choice])), [choices]);

    useKeypress((key) => {
      if (status === 'done') return;

      if (isEnterKey(key)) {
        if (validate) {
          const result = validate(selectedValues);
          if (result !== true) {
            setError(typeof result === 'string' ? result : 'Invalid');
            return;
          }
        }
        setStatus('done');
        done(selectedValues);
        return;
      }

      if (key.name === 'space') {
        const choice = filteredChoices[cursor];
        if (!choice) return;
        if (selectedSet.has(choice.value)) {
          setSelectedValues(selectedValues.filter((value) => value !== choice.value));
        } else {
          setSelectedValues([...selectedValues, choice.value]);
        }
        return;
      }

      if (isBackspaceKey(key)) {
        if (searchText === '' && selectedValues.length > 0) {
          setSelectedValues(selectedValues.slice(0, -1));
        } else {
          setSearchText(searchText.slice(0, -1));
          setCursor(0);
        }
        return;
      }

      if (isUpKey(key)) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }

      if (isDownKey(key)) {
        setCursor(Math.min(filteredChoices.length - 1, cursor + 1));
        return;
      }

      if (key.name && key.name.length === 1 && !key.ctrl) {
        setSearchText(searchText + key.name);
        setCursor(0);
      }
    });

    if (status === 'done') {
      const names = selectedValues.map((value) => choiceMap.get(value)?.name ?? value).join(', ');
      return `${prefix} ${ansi.bold(message)} ${ansi.cyan(names || '(none)')}`;
    }

    const lines: string[] = [];
    lines.push(`${prefix} ${ansi.bold(message)}`);

    const chips = selectedValues.length > 0
      ? selectedValues.map((value) => ansi.inverse(` ${choiceMap.get(value)?.name ?? value} `)).join(' ')
      : ansi.dim('(none selected)');
    lines.push(`  Selected: ${chips}`);
    lines.push(`  Search: ${ansi.yellow('[')}${searchText || ansi.dim('type to filter')}${ansi.yellow(']')}`);
    lines.push(`  ${ansi.cyan('↑↓')} navigate • ${ansi.cyan('Space')} toggle • ${ansi.cyan('Backspace')} remove • ${ansi.cyan('Enter')} confirm`);

    if (filteredChoices.length === 0) {
      lines.push(`  ${ansi.yellow('No matches')}`);
    } else {
      const startIndex = Math.max(0, Math.min(cursor - Math.floor(pageSize / 2), filteredChoices.length - pageSize));
      const endIndex = Math.min(startIndex + pageSize, filteredChoices.length);
      const visibleChoices = filteredChoices.slice(startIndex, endIndex);

      for (let i = 0; i < visibleChoices.length; i += 1) {
        const item = visibleChoices[i];
        const actualIndex = startIndex + i;
        const isActive = actualIndex === cursor;
        const selected = selectedSet.has(item.value);
        const icon = selected ? ansi.green('◉') : ansi.dim('○');
        const arrow = isActive ? ansi.cyan('›') : ' ';
        const name = isActive ? ansi.cyan(item.name) : item.name;
        const suffix = item.description ? ansi.dim(` (${item.description})`) : '';
        const selectedSuffix = selected ? ansi.dim(' (selected)') : '';
        lines.push(`  ${arrow} ${icon} ${name}${selected ? selectedSuffix : suffix}`);
      }

      if (filteredChoices.length > pageSize) {
        const currentPage = Math.floor(cursor / pageSize) + 1;
        const totalPages = Math.ceil(filteredChoices.length / pageSize);
        lines.push(ansi.dim(`  (${currentPage}/${totalPages})`));
      }
    }

    if (error) lines.push(`  ${ansi.red(error)}`);
    return lines.join('\n');
  });
}

export async function searchableMultiSelect(config: Config): Promise<string[]> {
  const prompt = await createSearchableMultiSelect();
  return prompt(config);
}
