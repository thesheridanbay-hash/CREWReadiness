"use client";

export const Row = ({
  label,
  onDelete,
  disabled,
}: {
  label: string;
  onDelete: () => void;
  disabled: boolean;
}) => (
  <div className="flex items-center justify-between">
    <span className="font-bold text-neutral-700">{label}</span>
    <button
      type="button"
      onClick={onDelete}
      disabled={disabled}
      className="text-xs font-bold uppercase text-rose-500 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  </div>
);
