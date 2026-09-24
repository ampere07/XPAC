import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Tag } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ExpensesCategoryFormModal from '../modals/ExpensesCategoryFormModal';
import {
  getExpensesCategories,
  createExpensesCategory,
  updateExpensesCategory,
  deleteExpensesCategory,
  ExpensesCategory,
} from '../services/expensesCategoryService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import { usePageActions } from '../hooks/usePageActions';

const ExpensesCategoryList: React.FC = () => {
  // Add, Edit and Delete are granted separately (expenses-category.create / .edit /
  // .delete), the same keys the API checks, so a control is drawn only when
  // the request behind it would succeed.
  const actions = usePageActions('expenses-category');

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [categories, setCategories] = useState<ExpensesCategory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<ExpensesCategory | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const fetchCategories = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      setCategories(await getExpensesCategories());
    } catch (err) {
      console.error('Error fetching expenses categories:', err);
      setError('Failed to fetch expenses categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const applyTheme = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    const handleUpdate = () => {
      fetchCategories(true).catch((err) =>
        console.error('[ExpensesCategory Soketi] Failed to refresh data:', err)
      );
    };

    const channel = pusher.subscribe('expenses-categories');
    channel.bind('expenses-category-updated', handleUpdate);

    return () => {
      channel.unbind('expenses-category-updated', handleUpdate);
      pusher.unsubscribe('expenses-categories');
    };
  }, [fetchCategories]);

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAdd = () => {
    if (!actions.canCreate) return;
    setEditing(null);
    setIsModalOpen(true);
  };

  const handleEdit = (category: ExpensesCategory) => {
    if (!actions.canEdit) return;
    setEditing(category);
    setIsModalOpen(true);
  };

  const handleSave = async (data: { name: string; modified_by?: string }) => {
    if (editing) {
      const updated = await updateExpensesCategory(editing.id, data);
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } else {
      const created = await createExpensesCategory(data);
      setCategories((prev) => [created, ...prev]);
    }
  };

  const handleDelete = async (category: ExpensesCategory) => {
    if (!actions.canDelete) return;
    if (!window.confirm(`Delete the category "${category.name}"?`)) return;

    try {
      await deleteExpensesCategory(category.id);
      setCategories((prev) => prev.filter((c) => c.id !== category.id));
    } catch (err: any) {
      // The API refuses to delete a category still referenced by expenses, and
      // that reason is worth surfacing verbatim rather than a generic failure.
      alert(err?.response?.data?.message || 'Failed to delete category. Please try again.');
    }
  };

  const formatDateTime = (value?: string) => {
    if (!value) return '';
    try {
      return new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  const accent = colorPalette?.primary || '#7c3aed';

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2 mb-4 mx-auto"
            style={{ borderColor: 'transparent', borderBottomColor: accent }}
          />
          <div className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Loading categories...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
        <div className="text-center">
          <div className={`text-lg mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Error Loading Categories
          </div>
          <div className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{error}</div>
          <button
            onClick={() => fetchCategories()}
            className="text-white px-4 py-2 rounded transition-colors"
            style={{ backgroundColor: accent }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div
        className={`px-6 py-4 border-b flex-shrink-0 ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Expenses Category
        </h1>
      </div>

      <div
        className={`px-6 py-4 border-b flex-shrink-0 ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search Expenses Category"
          />
          {actions.canCreate && (
            <button
              onClick={handleAdd}
              className="text-white px-4 py-2 rounded text-sm flex items-center space-x-2 transition-colors ml-4 flex-shrink-0"
              style={{ backgroundColor: accent }}
            >
              <Plus size={16} />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredCategories.length > 0 ? (
          <div className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-200'}`}>
            {filteredCategories.map((category) => (
              <div
                key={category.id}
                className={`px-6 py-4 flex items-center justify-between transition-colors ${
                  isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="p-2 rounded flex-shrink-0"
                    style={{ backgroundColor: `${accent}1a` }}
                  >
                    <Tag size={16} style={{ color: accent }} />
                  </div>
                  <div className="min-w-0">
                    <div
                      className={`font-medium text-lg truncate ${
                        isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}
                    >
                      {category.name}
                    </div>
                    <div className={`text-sm mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {typeof category.expense_count === 'number' && (
                        <span className="mr-3">
                          {category.expense_count} expense{category.expense_count === 1 ? '' : 's'}
                        </span>
                      )}
                      {formatDateTime(category.modified_date || category.updated_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {actions.canEdit && (
                    <button
                      onClick={() => handleEdit(category)}
                      className={`p-2 rounded transition-colors ${
                        isDarkMode
                          ? 'text-gray-400 hover:text-green-400'
                          : 'text-gray-600 hover:text-green-600'
                      }`}
                      title="Edit"
                    >
                      <Edit size={16} />
                    </button>
                  )}
                  {actions.canDelete && (
                    <button
                      onClick={() => handleDelete(category)}
                      className={`p-2 rounded transition-colors ${
                        isDarkMode ? 'text-gray-400 hover:text-red-400' : 'text-gray-600 hover:text-red-600'
                      }`}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`p-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            <div className="text-lg mb-2">No categories found</div>
            <div className="text-sm">
              {categories.length === 0
                ? 'Start by adding an expenses category'
                : 'Try adjusting your search filter'}
            </div>
          </div>
        )}
      </div>

      <ExpensesCategoryFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        category={editing}
      />
    </div>
  );
};

export default ExpensesCategoryList;
