export function convertTimestampsToDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  // If it's a Firebase Timestamp
  if (typeof obj.toDate === 'function') {
    return obj.toDate();
  }
  
  if (obj instanceof Date) return obj;

  if (typeof obj === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
    const parsed = new Date(obj);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(convertTimestampsToDates);
  }
  
  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
  }
  
  return obj;
}
