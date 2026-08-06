// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Password field with a show/hide toggle. */
export function PasswordInput({
  id,
  name,
  autoComplete,
  minLength,
  required = true,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-700"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
