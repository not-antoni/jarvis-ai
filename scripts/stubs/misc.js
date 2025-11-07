export function clean(value) {
  return value;
}

export function isEmpty(value) {
  return !value || !String(value).trim();
}

export function random(list) {
  if (Array.isArray(list) && list.length) {
    return list[0];
  }
  return null;
}
