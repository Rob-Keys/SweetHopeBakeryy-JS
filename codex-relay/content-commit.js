const REPOSITORY = 'Rob-Keys/SweetHopeBakeryy-JS';
const CONTENT_PATHS = Object.freeze({
  products: 'src/data/products.json',
  home_page: 'src/data/home_page.json',
  about_page: 'src/data/about_page.json',
  contact_page: 'src/data/contact_page.json'
});
const API = `https://api.github.com/repos/${REPOSITORY}`;

function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function invalid(message) {
  return jsonResponse({ success: false, error: message }, 400);
}

function validItem(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

async function github(token, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SweetHopeBakery-Customize-Relay',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      const messages = [body?.message, ...(Array.isArray(body?.errors) ? body.errors.map(item => item?.message || item?.code) : [])]
        .filter(value => typeof value === 'string' && value.trim());
      detail = messages.join('; ');
    } catch {
      // Keep the status when GitHub returns a non-JSON error body.
    }
    const error = new Error(`GitHub API request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function decodeFile(content) {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function applyOperation(data, request) {
  const { operation, tableName } = request;
  if (!Array.isArray(data)) throw new Error('The repository content file must contain a JSON array.');
  const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';

  if (operation === 'save') {
    const { item, createOnly = false, previousKey = null } = request;
    if (!validItem(item)) return invalid('Invalid item.');
    if (typeof createOnly !== 'boolean') return invalid('Invalid create-only setting.');
    const updatedItem = structuredClone(item);
    let partitionValue = updatedItem[partitionKey];

    if (tableName === 'products') {
      if (typeof partitionValue !== 'string' || !partitionValue.trim()) return invalid('Product name is required.');
      partitionValue = partitionValue.trim();
      updatedItem[partitionKey] = partitionValue;
    }
    if (createOnly && tableName !== 'products') {
      const numericIndex = Number(partitionValue);
      if (!Number.isInteger(numericIndex)) return invalid('Section index must be a whole number.');
      if (tableName === 'contact_page' && numericIndex < 3) return invalid('Contact page section indexes must be 3 or greater.');
      partitionValue = String(numericIndex);
      updatedItem[partitionKey] = partitionValue;
    }

    if (previousKey !== null) {
      if (tableName !== 'products' || typeof previousKey !== 'string' || !previousKey.trim()) return invalid('Original product name is required.');
      const oldKey = previousKey.trim();
      const oldIndex = data.findIndex(entry => String(entry?.[partitionKey]) === oldKey);
      if (oldIndex < 0) return jsonResponse({ success: false, error: 'Original product no longer exists.' }, 404);
      const duplicateIndex = data.findIndex(entry => String(entry?.[partitionKey]) === partitionValue);
      if (oldKey !== partitionValue && duplicateIndex >= 0 && duplicateIndex !== oldIndex) {
        return jsonResponse({ success: false, error: 'A product with this name already exists.' }, 409);
      }
      data[oldIndex] = updatedItem;
    } else {
      const existingIndex = data.findIndex(entry => createOnly && tableName !== 'products'
        ? Number(entry?.[partitionKey]) === Number(partitionValue)
        : String(entry?.[partitionKey]) === String(partitionValue));
      if (existingIndex >= 0) {
        if (createOnly) {
          return jsonResponse({ success: false, error: tableName === 'products'
            ? 'A product with this name already exists.'
            : 'A section with this index already exists.' }, 409);
        }
        data[existingIndex] = updatedItem;
      } else {
        data.push(updatedItem);
      }
    }
    return { data, action: 'Save' };
  }

  if (operation === 'delete') {
    const { key } = request;
    if ((typeof key !== 'string' && typeof key !== 'number') || !String(key).trim()) return invalid('Item key is required.');
    if (tableName === 'contact_page') {
      const ordered = [...data].sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
      const targetIndex = ordered.findIndex(section => String(section?.[partitionKey]) === String(key));
      if (targetIndex >= 0 && targetIndex < 3) {
        return jsonResponse({ success: false, error: 'The first three contact sections are required and cannot be removed.' }, 409);
      }
    }
    const filtered = data.filter(entry => String(entry?.[partitionKey]) !== String(key));
    if (filtered.length === data.length) return jsonResponse({ success: false, error: 'Item no longer exists.' }, 404);
    return { data: filtered, action: 'Delete' };
  }

  return invalid('Invalid content operation.');
}

export async function commitContentChange(token, request) {
  if (!request || typeof request !== 'object' || !CONTENT_PATHS[request.tableName]) return invalid('Invalid table name.');
  const branch = await github(token, '/git/ref/heads/main');
  const headSha = branch?.object?.sha;
  if (!headSha) throw new Error('Could not read the repository main branch.');

  const path = CONTENT_PATHS[request.tableName];
  const file = await github(token, `/contents/${path}?ref=${encodeURIComponent(headSha)}`);
  const data = decodeFile(file.content);
  const change = applyOperation(data, request);
  if (change instanceof Response) return change;

  const content = `${JSON.stringify(change.data, null, 2)}\n`;
  const parent = await github(token, `/git/commits/${encodeURIComponent(headSha)}`);
  if (!parent?.tree?.sha) throw new Error('Could not read the repository main tree.');
  const tree = await github(token, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: [{ path, mode: '100644', type: 'blob', content }]
    })
  });
  const commit = await github(token, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `Customize: ${change.action} ${request.tableName}`,
      tree: tree.sha,
      parents: [headSha]
    })
  });
  try {
    await github(token, '/git/refs/heads/main', {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } catch (error) {
    if ([409, 422].includes(error.status)) {
      return jsonResponse({ success: false, error: 'Another change reached GitHub first. Reload the editor and try again.' }, 409);
    }
    throw error;
  }
  return jsonResponse({ success: true, commit: commit.sha });
}
