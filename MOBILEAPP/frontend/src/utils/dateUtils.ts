import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const MANILA_TIMEZONE = 'Asia/Manila';

/**
 * Formats a date to MySQL format (YYYY-MM-DD HH:mm:ss) in GMT+8 (Asia/Manila)
 */
export const formatToGMT8MySQL = (date: Date = new Date()): string => {
  return dayjs(date).tz(MANILA_TIMEZONE).add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
};

/**
 * Formats a date to a display format (MM/DD/YYYY, HH:mm:ss AM/PM) in GMT+8
 */
export const formatToGMT8Display = (date: Date = new Date()): string => {
  return dayjs(date).tz(MANILA_TIMEZONE).add(8, 'hour').format('MM/DD/YYYY, hh:mm:ss A');
};

/**
 * Gets just the date part (YYYY-MM-DD) in GMT+8
 */
export const getGMT8DateOnly = (date: Date = new Date()): string => {
  return dayjs(date).tz(MANILA_TIMEZONE).add(8, 'hour').format('YYYY-MM-DD');
};
