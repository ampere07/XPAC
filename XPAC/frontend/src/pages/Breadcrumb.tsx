import React from 'react';

interface BreadcrumbProps {
  items: Array<{ label: string; href?: string; onClick?: () => void }>;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <div className="px-6 py-3">
      <nav className="flex" aria-label="Breadcrumb">
        <ol className="inline-flex items-center space-x-1 md:space-x-3">
          {items.map((item, index) => (
            <li key={index} className="inline-flex items-center">
              {index > 0 && (
                <svg className="w-4 h-4 text-gray-400 mx-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              )}
              {item.onClick ? (
                <button
                  onClick={item.onClick}
                  className={`text-sm font-medium ${
                    index === items.length - 1
                      ? 'text-white'
                      : 'text-gray-400 hover:text-gray-300 cursor-pointer'
                  }`}
                >
                  {item.label}
                </button>
              ) : item.href ? (
                <a
                  href={item.href}
                  className={`text-sm font-medium ${
                    index === items.length - 1
                      ? 'text-white'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  {item.label}
                </a>
              ) : (
                <span className={`text-sm font-medium ${
                  index === items.length - 1
                    ? 'text-white'
                    : 'text-gray-400 hover:text-gray-300'
                }`}>
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
};

export default Breadcrumb;
