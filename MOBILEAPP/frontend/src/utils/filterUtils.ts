import { FilterValues } from '../filter/ApplicationVisitFunnelFilter';

export function applyFilters<T extends Record<string, any>>(
  data: T[],
  filters: FilterValues
): T[] {
  if (!filters || Object.keys(filters).length === 0) {
    return data;
  }

  return data.filter(item => {
    return Object.keys(filters).every(key => {
      const filter = filters[key];
      const value = item[key];

      if (!filter) return true;

      // Handle text filters
      if (filter.type === 'text' && filter.value) {
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(filter.value.toLowerCase());
      }

      // Handle number filters
      if (filter.type === 'number') {
        const numValue = Number(value);
        if (isNaN(numValue)) return false;

        if (filter.from !== undefined && numValue < Number(filter.from)) {
          return false;
        }
        if (filter.to !== undefined && numValue > Number(filter.to)) {
          return false;
        }
        return true;
      }

      // Handle date filters
      if (filter.type === 'date') {
        if (!value) return false;
        const dateValue = new Date(value).getTime();

        if (filter.from) {
          const fromDate = new Date(filter.from).getTime();
          if (dateValue < fromDate) return false;
        }
        if (filter.to) {
          const toDate = new Date(filter.to).getTime();
          if (dateValue > toDate) return false;
        }
        return true;
      }

      return true;
    });
  });
}
