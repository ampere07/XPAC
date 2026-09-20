import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

interface BreadcrumbProps {
  items: Array<{ label: string; href?: string; onClick?: () => void }>;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  const isDarkMode = false;
  const activeColor = '#111827';
  const mutedColor = '#6b7280';

  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
      <View
        accessibilityRole="header"
        accessibilityLabel="Breadcrumb"
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const color = isLast ? activeColor : mutedColor;

          const labelNode = (
            <Text style={{ fontSize: 14, fontWeight: '500', color }}>
              {item.label}
            </Text>
          );

          return (
            <View
              key={index}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              {index > 0 && (
                <ChevronRight
                  size={16}
                  color="#9ca3af"
                  style={{ marginHorizontal: 4 }}
                />
              )}
              {item.onClick ? (
                <TouchableOpacity onPress={item.onClick}>
                  {labelNode}
                </TouchableOpacity>
              ) : (
                labelNode
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default Breadcrumb;
