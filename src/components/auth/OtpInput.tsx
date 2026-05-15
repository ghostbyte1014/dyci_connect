import React, { useState, useRef, useEffect } from 'react';
import { FaLock } from 'react-icons/fa';

interface OtpInputProps {
  onSubmit: (code: string, rememberDevice: boolean) => void;
  isLoading: boolean;
  onCancel: () => void;
  email: string;
}

const OtpInput: React.FC<OtpInputProps> = ({ onSubmit, isLoading, onCancel, email }) => {
  const [code, setCode] = useState<string[]>(Array(8).fill(''));
  const [rememberDevice, setRememberDevice] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Auto-focus the first input on mount
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (isNaN(Number(value))) return;

    const newCode = [...code];
    // Take only the last character in case they paste multiple
    newCode[index] = value.substring(value.length - 1);
    setCode(newCode);

    // Move to next input if value is entered
    if (value && index < 7 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all 8 are filled
    if (index === 7 && value && newCode.every((digit) => digit !== '')) {
      // Optional: Auto submit or let them press a button
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 8);
    if (pastedData) {
      const newCode = [...code];
      for (let i = 0; i < pastedData.length; i++) {
        newCode[i] = pastedData[i];
      }
      setCode(newCode);
      
      // Focus the next empty input or the last one
      const focusIndex = Math.min(pastedData.length, 7);
      inputRefs.current[focusIndex]?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCode = code.join('');
    if (finalCode.length === 8) {
      onSubmit(finalCode, rememberDevice);
    }
  };

  return (
    <div className="w-full animate-in fade-in zoom-in duration-300">
      <div className="text-center mb-6">
        <div className="mx-auto h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
          <FaLock className="h-5 w-5 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">New Device Detected</h2>
        <p className="text-sm text-gray-500">
          For your security, please enter the 8-digit verification code sent to <span className="font-medium text-gray-900">{email}</span>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-center gap-2 sm:gap-3">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(index, e)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              disabled={isLoading}
              className="w-8 h-10 sm:w-10 sm:h-12 text-center text-lg sm:text-xl font-bold text-gray-900 bg-white border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 transition-colors disabled:opacity-50"
            />
          ))}
        </div>

        <div className="flex items-center justify-center pt-2">
          <label className="inline-flex items-center space-x-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              disabled={isLoading}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 transition-colors cursor-pointer"
            />
            <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
              Trust this device for future logins
            </span>
          </label>
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="submit"
            disabled={isLoading || code.some((d) => d === '')}
            className="w-full inline-flex justify-center items-center rounded-xl bg-[#1434A4] hover:bg-[#102a82] text-white text-sm font-semibold py-3 sm:py-3.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? 'Verifying...' : 'Verify & Continue'}
          </button>
          
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Cancel and return to login
          </button>
        </div>
      </form>
    </div>
  );
};

export default OtpInput;
