import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TechnicianFilterModal, TechnicianFilterValue, buildTechnicianOptions, matchesTechnicianFilter
} from './TechnicianFilter';

jest.mock('../config/api', () => ({ __esModule: true, default: {}, API_BASE_URL: '' }));

const user = (id: number, email: string, roleId: number, first = '', last = '') => ({
  id, email_address: email, role_id: roleId, first_name: first, last_name: last,
  username: email, created_at: '', updated_at: ''
}) as any;

describe('buildTechnicianOptions', () => {
  it('offers only technicians assigned on the records, sorted by name', () => {
    const users = [
      user(1, 'Tech01@gmail.com', 2, 'Zed', 'Tech'),
      user(2, 'tech02@gmail.com', 2, 'Amy', 'Tech'),
      user(3, 'admin@gmail.com', 1, 'Ann', 'Admin'),
      user(4, 'idle@gmail.com', 2, 'Idle', 'Tech'),
    ];

    const options = buildTechnicianOptions(users, ['tech01@gmail.com', ' TECH02@gmail.com ', 'admin@gmail.com', '', 'ghost@gmail.com']);

    expect(options).toEqual([
      { email: 'tech02@gmail.com', label: 'Amy Tech' },
      { email: 'tech01@gmail.com', label: 'Zed Tech' },
    ]);
  });
});

describe('matchesTechnicianFilter', () => {
  const filter = (dateFrom = '', dateTo = ''): TechnicianFilterValue =>
    ({ technician: { email: 'tech01@gmail.com', label: 'Tech' }, dateFrom, dateTo });

  it('passes everything when no filter is set', () => {
    expect(matchesTechnicianFilter(null, 'anyone@gmail.com', '2026-10-10 08:00:00')).toBe(true);
  });

  it('matches the assigned email case-insensitively', () => {
    expect(matchesTechnicianFilter(filter(), 'TECH01@gmail.com', '2026-10-10 08:00:00')).toBe(true);
    expect(matchesTechnicianFilter(filter(), 'tech02@gmail.com', '2026-10-10 08:00:00')).toBe(false);
  });

  it('keeps both ends of the date range, whatever the time of day', () => {
    const range = filter('2026-10-01', '2026-10-10');
    expect(matchesTechnicianFilter(range, 'tech01@gmail.com', '2026-10-01 00:00:00')).toBe(true);
    expect(matchesTechnicianFilter(range, 'tech01@gmail.com', '2026-10-10 23:59:59')).toBe(true);
    expect(matchesTechnicianFilter(range, 'tech01@gmail.com', '2026-09-30 23:59:59')).toBe(false);
    expect(matchesTechnicianFilter(range, 'tech01@gmail.com', '2026-10-11 00:00:00')).toBe(false);
    expect(matchesTechnicianFilter(range, 'tech01@gmail.com', null)).toBe(false);
  });
});

describe('TechnicianFilterModal', () => {
  const technicians = [
    { email: 'tech01@gmail.com', label: 'Zed Tech' },
    { email: 'tech02@gmail.com', label: 'Amy Tech' },
  ];

  it('applies the picked technician and dates', () => {
    const onApply = jest.fn();
    render(
      <TechnicianFilterModal
        initial={null}
        technicians={technicians}
        isLoading={false}
        dateHint="By job order timestamp."
        onApply={onApply}
        onClose={() => {}}
        isDarkMode
        primaryColor="#000"
      />
    );

    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    fireEvent.focus(screen.getByPlaceholderText('Search technician…'));
    fireEvent.change(screen.getByPlaceholderText('Search technician…'), { target: { value: 'amy' } });
    expect(screen.queryByLabelText('Select technician Zed Tech')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select technician Amy Tech'));

    fireEvent.change(screen.getByLabelText('Date From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Date To'), { target: { value: '2026-10-10' } });
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledWith({
      technician: { email: 'tech02@gmail.com', label: 'Amy Tech' },
      dateFrom: '2026-10-01',
      dateTo: '2026-10-10',
    });
  });

  it('refuses a range that ends before it starts', () => {
    render(
      <TechnicianFilterModal
        initial={{ technician: technicians[0], dateFrom: '2026-10-10', dateTo: '2026-10-01' }}
        technicians={technicians}
        isLoading={false}
        dateHint=""
        onApply={() => {}}
        onClose={() => {}}
        isDarkMode={false}
        primaryColor="#000"
      />
    );

    expect(screen.getByText('Date From must be on or before Date To.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
