/**
 * Generic Multi-Select Component (Search + Checkbox List + Chips + Select All/Clear All)
 * Vanilla JS, no dependencies. Renders into a given container and returns a small API
 * so callers (e.g. the cascading Location fields) can read/set the selection and react to changes.
 */
function createMultiSelect(config) {
  const {
    container,
    controlId,
    fieldLabel = '',
    placeholder = 'Select...',
    searchPlaceholder = 'Search...',
    icon = null,
    options = [],
    selected = [],
    disabled = false,
    maxVisibleOptions = 300,
    maxVisibleChips = 30
  } = config;

  let currentOptions = [...options];
  let selectedSet = new Set(selected);
  let searchQuery = '';
  let isOpen = false;
  let isDisabled = !!disabled;
  let showAllChips = false;
  const changeHandlers = [];

  container.innerHTML = '';
  container.classList.add('input-icon-wrap', 'multi-select');

  if (icon) {
    const iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconEl.setAttribute('class', 'input-icon');
    iconEl.setAttribute('aria-hidden', 'true');
    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    useEl.setAttribute('href', `#${icon}`);
    iconEl.appendChild(useEl);
    container.appendChild(iconEl);
  }

  const control = document.createElement('div');
  control.className = 'form-control multi-select-control';
  control.id = controlId;
  control.tabIndex = 0;
  control.setAttribute('role', 'combobox');
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute('aria-expanded', 'false');
  control.setAttribute('aria-required', 'true');
  if (fieldLabel) control.setAttribute('aria-label', fieldLabel);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'multi-select-chips';

  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  caret.setAttribute('class', 'ms-caret');
  caret.setAttribute('viewBox', '0 0 24 24');
  caret.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>';

  control.appendChild(chipsWrap);
  control.appendChild(caret);

  const panel = document.createElement('div');
  panel.className = 'multi-select-panel';

  const searchRow = document.createElement('div');
  searchRow.className = 'ms-search-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'ms-search-input';
  searchInput.placeholder = searchPlaceholder;
  searchRow.appendChild(searchInput);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'ms-actions-row';
  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'ms-action-btn';
  selectAllBtn.textContent = 'Select All';
  const clearAllBtn = document.createElement('button');
  clearAllBtn.type = 'button';
  clearAllBtn.className = 'ms-action-btn ms-clear-btn';
  clearAllBtn.textContent = 'Clear All';
  const countLabel = document.createElement('span');
  countLabel.className = 'ms-count';
  actionsRow.appendChild(selectAllBtn);
  actionsRow.appendChild(clearAllBtn);
  actionsRow.appendChild(countLabel);

  const optionsList = document.createElement('div');
  optionsList.className = 'ms-options-list';
  optionsList.setAttribute('role', 'listbox');
  optionsList.setAttribute('aria-multiselectable', 'true');

  panel.appendChild(searchRow);
  panel.appendChild(actionsRow);
  panel.appendChild(optionsList);

  container.appendChild(control);
  container.appendChild(panel);

  function getFilteredOptions() {
    if (!searchQuery) return currentOptions;
    const q = searchQuery.toLowerCase();
    return currentOptions.filter(opt => opt.toLowerCase().includes(q));
  }

  function renderChips() {
    chipsWrap.innerHTML = '';
    const selectedArr = Array.from(selectedSet);

    if (selectedArr.length === 0) {
      const ph = document.createElement('span');
      ph.className = 'ms-placeholder';
      ph.textContent = placeholder;
      chipsWrap.appendChild(ph);
      return;
    }

    const visible = showAllChips ? selectedArr : selectedArr.slice(0, maxVisibleChips);
    visible.forEach(val => {
      const chip = document.createElement('span');
      chip.className = 'ms-chip';
      chip.title = val;

      const label = document.createElement('span');
      label.className = 'ms-chip-label';
      label.textContent = val;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'ms-chip-remove';
      removeBtn.setAttribute('aria-label', `Remove ${val}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedSet.delete(val);
        commitChange();
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      chipsWrap.appendChild(chip);
    });

    if (selectedArr.length > maxVisibleChips) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ms-chip ms-chip-more';
      toggle.textContent = showAllChips ? 'Show less' : `+${selectedArr.length - maxVisibleChips} more`;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        showAllChips = !showAllChips;
        renderChips();
      });
      chipsWrap.appendChild(toggle);
    }
  }

  function renderOptionsList() {
    const filtered = getFilteredOptions();
    optionsList.innerHTML = '';

    if (currentOptions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ms-empty-msg';
      empty.textContent = 'No options available yet - make a selection above first.';
      optionsList.appendChild(empty);
      return;
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ms-empty-msg';
      empty.textContent = 'No matches found.';
      optionsList.appendChild(empty);
      return;
    }

    const capped = filtered.slice(0, maxVisibleOptions);
    capped.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'ms-option';
      item.setAttribute('role', 'option');
      const isChecked = selectedSet.has(opt);
      item.setAttribute('aria-selected', String(isChecked));
      if (isChecked) item.classList.add('is-selected');

      const checkbox = document.createElement('span');
      checkbox.className = 'ms-checkbox' + (isChecked ? ' checked' : '');

      const label = document.createElement('span');
      label.className = 'ms-option-label';
      label.textContent = opt;

      item.appendChild(checkbox);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (selectedSet.has(opt)) {
          selectedSet.delete(opt);
        } else {
          selectedSet.add(opt);
        }
        commitChange();
      });

      optionsList.appendChild(item);
    });

    if (filtered.length > maxVisibleOptions) {
      const hint = document.createElement('div');
      hint.className = 'ms-empty-msg';
      hint.textContent = `Showing ${maxVisibleOptions} of ${filtered.length} matches - keep typing to narrow down.`;
      optionsList.appendChild(hint);
    }
  }

  function updateCount() {
    const n = selectedSet.size;
    countLabel.textContent = n === 0 ? 'No locations selected' : `${n} location${n === 1 ? '' : 's'} selected`;
  }

  function renderAll() {
    renderChips();
    renderOptionsList();
    updateCount();
  }

  // Used by user-driven interactions (click/select-all/clear-all/chip-remove/setSelected/clear):
  // re-renders and notifies subscribers.
  function commitChange() {
    renderAll();
    const arr = Array.from(selectedSet);
    changeHandlers.forEach(fn => fn(arr));
  }

  function openPanel() {
    if (isDisabled) return;
    isOpen = true;
    panel.classList.add('open');
    control.setAttribute('aria-expanded', 'true');
    searchQuery = '';
    searchInput.value = '';
    renderOptionsList();
    searchInput.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    control.setAttribute('aria-expanded', 'false');
  }

  control.addEventListener('click', () => {
    if (isOpen) closePanel(); else openPanel();
  });

  control.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) closePanel(); else openPanel();
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderOptionsList();
  });

  // Pressing Enter in the search box toggles the first visible match - lets keyboard-only
  // users type a name and hit Enter repeatedly to add several locations without a mouse.
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = getFilteredOptions()[0];
      if (first) {
        if (selectedSet.has(first)) selectedSet.delete(first); else selectedSet.add(first);
        commitChange();
        searchInput.focus();
      }
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });

  searchInput.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('click', (e) => e.stopPropagation());

  selectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    getFilteredOptions().forEach(opt => selectedSet.add(opt));
    commitChange();
  });

  clearAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedSet.clear();
    commitChange();
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      closePanel();
    }
  });

  // Updates the available option list (e.g. when a parent location level changes).
  // Silently prunes now-invalid selections and re-renders - does NOT notify subscribers,
  // since cascading callers are expected to explicitly sync every downstream level themselves.
  function setOptions(newOptions) {
    currentOptions = [...newOptions];
    const optionSet = new Set(currentOptions);
    const pruned = new Set();
    selectedSet.forEach(val => {
      if (optionSet.has(val)) pruned.add(val);
    });
    selectedSet = pruned;
    renderAll();
  }

  function setDisabled(state) {
    isDisabled = !!state;
    if (isDisabled) {
      control.classList.add('is-disabled');
      closePanel();
    } else {
      control.classList.remove('is-disabled');
    }
  }

  function getSelected() {
    return Array.from(selectedSet);
  }

  function setSelected(arr) {
    const optionSet = new Set(currentOptions);
    selectedSet = new Set((arr || []).filter(v => optionSet.has(v)));
    commitChange();
  }

  function clear() {
    selectedSet.clear();
    commitChange();
  }

  function onChange(fn) {
    changeHandlers.push(fn);
  }

  renderAll();
  if (isDisabled) setDisabled(true);

  return {
    getSelected,
    setSelected,
    setOptions,
    setDisabled,
    clear,
    onChange,
    controlEl: control
  };
}

if (typeof window !== 'undefined') {
  window.createMultiSelect = createMultiSelect;
}
