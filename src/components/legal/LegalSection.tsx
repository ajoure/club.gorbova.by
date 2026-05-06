// Shared renderer for nested legal-document items (id + text + subItems[]).
// Used by /offer, /order-payment, /instruction.

interface NestedItem {
  id: string;
  text: string;
  subItems?: NestedItem[];
}

export function LegalItem({ item, level = 0 }: { item: NestedItem; level?: number }) {
  return (
    <div>
      <p>
        <strong>{item.id}.</strong> {item.text}
      </p>
      {item.subItems && item.subItems.length > 0 && (
        <ul
          className={`list-none mt-2 space-y-2 ${
            level === 0 ? "ml-6" : level === 1 ? "ml-6" : "ml-6"
          }`}
        >
          {item.subItems.map((sub) => (
            <li key={sub.id}>
              <LegalItem item={sub} level={level + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
