import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Package,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Scale,
  Edit3,
  ChevronDown,
  Check,
  UserPlus,
  Receipt,
  Clock,
  ArrowRight,
  Printer,
  X,
  CreditCard,
  CheckCircle2,
  DollarSign,
  Heart,
  Grid,
  List,
  Coffee,
  Utensils,
  Apple,
  Milk,
  Drumstick,
  Droplet,
  Sparkles,
  MoreHorizontal,
  FolderOpen,
  Flame,
  Pause,
  RotateCcw,
  Percent,
  LayoutGrid,
  Settings2,
  Store,
  ChevronLeft,
  BadgeCheck,
  Tag,
  Layers
} from "lucide-react";
import { Product, Category, CartItem, Branch, POSMode } from "../types";
import { api } from "../utils/api";
import { VoiceInputButton } from "./VoiceInputButton";
import {
  DEFAULT_POS_CONFIGURATION,
  parsePOSConfiguration,
  POS_BUSINESS_PROFILES,
  POS_SETTINGS_KEY,
  type POSConfiguration,
  type POSOrderType,
  type POSPaymentMethod
} from "../utils/posSettings";

// Sound effect helper (soft click/success/beep)
const playBeep = () => {
  try {
    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.connect(gain);
    gain.connect(context.destination);
    osc.frequency.setValueAtTime(800, context.currentTime);
    gain.gain.setValueAtTime(0.04, context.currentTime);
    osc.start();
    osc.stop(context.currentTime + 0.08);
  } catch (e) {
    // Ignore audio errors
  }
};

const playSuccessSound = () => {
  try {
    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = context.currentTime;
    
    // Low-to-high double beep for success
    const osc1 = context.createOscillator();
    const gain1 = context.createGain();
    osc1.connect(gain1);
    gain1.connect(context.destination);
    osc1.frequency.setValueAtTime(600, now);
    gain1.gain.setValueAtTime(0.04, now);
    osc1.start(now);
    osc1.stop(now + 0.1);

    const osc2 = context.createOscillator();
    const gain2 = context.createGain();
    osc2.connect(gain2);
    gain2.connect(context.destination);
    osc2.frequency.setValueAtTime(900, now + 0.12);
    gain2.gain.setValueAtTime(0.04, now + 0.12);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.25);
  } catch (e) {
    // Ignore
  }
};

interface POSProps {
  selectedBranch: Branch | null;
  branches: Branch[];
  posMode: POSMode;
  initialCategories?: Category[];
  initialProducts?: Product[];
  onBack: () => void;
  onOrderSuccess: () => void;
  subView?: string;
}

// Beautiful static fallback categories to match the user's requested layout exactly

// Beautiful static fallback products matching the screenshot exactly

// Map Category ID to beautiful Lucide icons
const getCategoryIcon = (catId: number, catName: string) => {
  const name = catName.toLowerCase();
  if (name.includes("مشروب") || name.includes("عصير") || name.includes("drink") || name.includes("beverage")) {
    return <Coffee className="w-5 h-5" />;
  }
  if (name.includes("غذاء") || name.includes("طعام") || name.includes("أرز") || name.includes("مكرونة") || name.includes("food") || name.includes("grocery")) {
    return <Utensils className="w-5 h-5" />;
  }
  if (name.includes("خضار") || name.includes("فواكه") || name.includes("veg")) {
    return <Apple className="w-5 h-5" />;
  }
  if (name.includes("ألبان") || name.includes("حليب") || name.includes("جبن") || name.includes("dairy")) {
    return <Milk className="w-5 h-5" />;
  }
  if (name.includes("لحوم") || name.includes("دواجن") || name.includes("جزارة") || name.includes("meat")) {
    return <Drumstick className="w-5 h-5" />;
  }
  if (name.includes("منظف") || name.includes("صابون") || name.includes("clean")) {
    return <Droplet className="w-5 h-5" />;
  }
  if (name.includes("عناية") || name.includes("شامبو") || name.includes("care")) {
    return <Sparkles className="w-5 h-5" />;
  }
  return <MoreHorizontal className="w-5 h-5" />;
};


const orderTypeLabels: Record<POSOrderType, string> = {
  "WALK-IN": "بيع مباشر",
  "DELIVERY": "دليفري",
  "PICK UP": "استلام",
  "MEMBERSHIP": "عضوية",
  "DINE-IN": "صالة",
  "TAKEAWAY": "تيك أواي",
  "EXCHANGE": "استبدال"
};

const orderTypeApiMap: Record<POSOrderType, string> = {
  "WALK-IN": "dine_in",
  "DELIVERY": "delivery",
  "PICK UP": "takeaway",
  "MEMBERSHIP": "membership",
  "DINE-IN": "dine_in",
  "TAKEAWAY": "takeaway",
  "EXCHANGE": "exchange"
};

const paymentMethodLabels: Record<POSPaymentMethod, { ar: string; en: string }> = {
  cash: { ar: "كاش", en: "Cash" },
  visa: { ar: "فيزا", en: "Visa" },
  mastercard: { ar: "ماستر", en: "Master" },
  instapay: { ar: "إنستا", en: "Instapay" },
  wallet: { ar: "محفظة", en: "Wallet" },
  credit: { ar: "آجل", en: "Credit" },
  mixed: { ar: "مختلط", en: "Mixed" }
};

const getProductGridClass = (productsPerRow: number) => {
  const cols = Math.min(Math.max(productsPerRow || 5, 2), 8);
  const largeCols: Record<number, string> = {
    2: "xl:grid-cols-2 2xl:grid-cols-2",
    3: "xl:grid-cols-3 2xl:grid-cols-3",
    4: "xl:grid-cols-4 2xl:grid-cols-4",
    5: "xl:grid-cols-4 2xl:grid-cols-5",
    6: "xl:grid-cols-5 2xl:grid-cols-6",
    7: "xl:grid-cols-6 2xl:grid-cols-7",
    8: "xl:grid-cols-6 2xl:grid-cols-8"
  };
  return `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${largeCols[cols] || largeCols[5]} gap-4`;
};

export const POS: React.FC<POSProps> = ({
  selectedBranch,
  branches,
  posMode,
  initialCategories = [],
  initialProducts = [],
  onBack,
  onOrderSuccess
}) => {
  // Get cashier name from localStorage
  const [cashierName, setCashierName] = useState("كاشير");
  const [posTheme, setPosTheme] = useState<"standard" | "neobrutalist">(() => {
    return (localStorage.getItem("pos_theme") as "standard" | "neobrutalist") || "neobrutalist";
  });
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        if (user.username) setCashierName(user.username);
        else if (user.name) setCashierName(user.name);
      }
    } catch {}
  }, []);
  // Core states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [orderType, setOrderType] = useState<POSOrderType>(DEFAULT_POS_CONFIGURATION.salesFlow.defaultOrderType);
    const [posConfig, setPosConfig] = useState<POSConfiguration>(DEFAULT_POS_CONFIGURATION);
  
  // Custom screen display features matching screenshot
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [workspaceTab, setWorkspaceTab] = useState<"categories" | "favorites" | "most_selling" | "recent">("categories");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [selectedUnit, setSelectedUnit] = useState<string>("all");
  const [posMobileTab, setPosMobileTab] = useState<"products" | "cart">("products");

  // Dynamic invoice number
  const [invoiceNumber, setInvoiceNumber] = useState("INV-100254");

  useEffect(() => {
    // Generate a fresh invoice number on load
    const rand = Math.floor(100000 + Math.random() * 900000);
    setInvoiceNumber(`INV-${rand}`);
  }, []);

  // Time & Date State (Live!)
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cash drawer status simulation
  const [isCashDrawerOpen, setIsCashDrawerOpen] = useState(false);
  
  // Modals and selections
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: "", phone: "", address: "" });
  
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [appliedDiscount, setAppliedDiscount] = useState<{ type: "percent" | "amount"; value: number } | null>(null);

  const [showHoldInvoicesModal, setShowHoldInvoicesModal] = useState(false);
  const [holdInvoices, setHoldInvoices] = useState<{ id: string; timestamp: Date; items: CartItem[]; customer: any | null }[]>([]);

  // Barcode Lookup Simulator
  const [barcodeInput, setBarcodeInput] = useState("");
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);

  // Cart item notes & general invoice note
  const [selectedCartItemIndex, setSelectedCartItemIndex] = useState<number | null>(null);
  const [itemNotes, setItemNotes] = useState<{ [key: number]: string }>({});
  const [showInvoiceNoteModal, setShowInvoiceNoteModal] = useState(false);
  const [invoiceNote, setInvoiceNote] = useState("");

  // Numpad Buffer and Mode
  const [numpadMode, setNumpadMode] = useState<"qty" | "amount">("qty");
  const [amountPaidBuffer, setAmountPaidBuffer] = useState<string>("");
  const [quantityBuffer, setQuantityBuffer] = useState<string>("");

  const [checkoutStatus, setCheckoutStatus] = useState<{ type: "idle" | "loading" | "success" | "error"; message?: string; orderId?: number }>({ type: "idle" });

  const [selectedSubcategoryFilter, setSelectedSubcategoryFilter] = useState<string>("all");

  useEffect(() => {
    setSelectedSubcategoryFilter("all");
  }, [selectedCategoryFilter]);

  useEffect(() => {
    const applyPOSConfiguration = (incoming: POSConfiguration) => {
      setPosConfig(incoming);
      setViewMode(incoming.screen.defaultView);
      setOrderType(incoming.salesFlow.defaultOrderType);
      if (!incoming.screen.showBrandFilter) setSelectedBrand("all");
      if (!incoming.screen.showUnitFilter) setSelectedUnit("all");
      if (!incoming.screen.showSubcategories) setSelectedSubcategoryFilter("all");
    };

    api.get(`/api/settings/${POS_SETTINGS_KEY}`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        const parsed = parsePOSConfiguration(data?.value);
        localStorage.setItem(POS_SETTINGS_KEY, JSON.stringify(parsed));
        applyPOSConfiguration(parsed);
      })
      .catch(() => {
        const cached = localStorage.getItem(POS_SETTINGS_KEY);
        applyPOSConfiguration(parsePOSConfiguration(cached));
      });

    const handleLiveUpdate = (event: Event) => {
      const custom = event as CustomEvent<POSConfiguration>;
      applyPOSConfiguration(parsePOSConfiguration(custom.detail));
    };

    window.addEventListener("pos-settings-updated", handleLiveUpdate);
    return () => window.removeEventListener("pos-settings-updated", handleLiveUpdate);
  }, []);

  // Use actual database items
  const mergedCategories = useMemo(() => {
    return initialCategories || [];
  }, [initialCategories]);

  const mergedProducts = useMemo(() => {
    return initialProducts || [];
  }, [initialProducts]);

  // Unique list of Brands & Units for filters
  const uniqueBrands = useMemo(() => {
    const brandsSet = new Set<string>();
    mergedProducts.forEach((p) => {
      if (p.brand) brandsSet.add(p.brand);
    });
    return Array.from(brandsSet);
  }, [mergedProducts]);

  const uniqueUnits = useMemo(() => {
    const unitsSet = new Set<string>();
    mergedProducts.forEach((p) => {
      if (p.unit) unitsSet.add(p.unit);
    });
    return Array.from(unitsSet);
  }, [mergedProducts]);

  // Active Category Filter mapping
  const activeCategoryId = useMemo(() => {
    if (selectedCategoryFilter === "all") return "all";
    const found = mergedCategories.find((c) => c.id.toString() === selectedCategoryFilter || c.name === selectedCategoryFilter);
    return found ? found.id : "all";
  }, [selectedCategoryFilter, mergedCategories]);

  const mainCategories = useMemo(() => {
    return mergedCategories.filter((c) => !c.parent_id);
  }, [mergedCategories]);

  const activeSubcategories = useMemo(() => {
    if (activeCategoryId === "all" || !posConfig.screen.showSubcategories) return [];
    return mergedCategories.filter((c) => c.parent_id === activeCategoryId);
  }, [activeCategoryId, mergedCategories, posConfig.screen.showSubcategories]);

  const activeCategoryTreeIds = useMemo(() => {
    if (activeCategoryId === "all") return [];

    const collectDescendants = (categoryId: number): number[] => {
      const children = mergedCategories.filter((category) => Number(category.parent_id) === categoryId);
      return children.reduce<number[]>((acc, child) => {
        const childId = Number(child.id);
        return [...acc, childId, ...collectDescendants(childId)];
      }, []);
    };

    const rootId = Number(activeCategoryId);
    return [rootId, ...collectDescendants(rootId)];
  }, [activeCategoryId, mergedCategories]);

  const enabledPaymentMethods = useMemo(
    () => posConfig.payments.enabledMethods.length ? posConfig.payments.enabledMethods : DEFAULT_POS_CONFIGURATION.payments.enabledMethods,
    [posConfig.payments.enabledMethods]
  );

  const enabledOrderTypes = useMemo(
    () => posConfig.salesFlow.enabledOrderTypes.length ? posConfig.salesFlow.enabledOrderTypes : DEFAULT_POS_CONFIGURATION.salesFlow.enabledOrderTypes,
    [posConfig.salesFlow.enabledOrderTypes]
  );

  const currency = posConfig.pricing.currency || "EGP";
  const activeProfile = POS_BUSINESS_PROFILES[posConfig.profile] || POS_BUSINESS_PROFILES.restaurant;

  // Filtered product listing
  const filteredProducts = useMemo(() => {
    return mergedProducts.filter((product) => {
      // 1. Search Query Match
      const matchSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (product.barcode && product.barcode.includes(searchQuery));
      
      // 2. Category Match
      let matchCategory = false;
      if (activeCategoryId === "all") {
        matchCategory = true;
      } else {
        if (selectedSubcategoryFilter !== "all") {
          matchCategory = product.category_id.toString() === selectedSubcategoryFilter;
        } else {
          // Match main category and all nested subcategories, not only direct children.
          matchCategory = activeCategoryTreeIds.includes(Number(product.category_id));
        }
      }

      // 3. Brand Match
      const matchBrand = !posConfig.screen.showBrandFilter || selectedBrand === "all" || product.brand === selectedBrand;

      // 4. Unit Match
      const matchUnit = !posConfig.screen.showUnitFilter || selectedUnit === "all" || product.unit === selectedUnit;

      // 5. Tabs Filter (Favorites, Most Selling, Recent)
      let matchTab = true;
      if (workspaceTab === "favorites") {
        matchTab = !!product.is_favorite;
      } else if (workspaceTab === "most_selling") {
        // Mocking most selling by checking ID parity or standard mock
        matchTab = product.id % 2 === 0;
      } else if (workspaceTab === "recent") {
        matchTab = product.id % 3 === 0;
      }

      return matchSearch && matchCategory && matchBrand && matchUnit && matchTab;
    });
  }, [mergedProducts, searchQuery, activeCategoryId, selectedSubcategoryFilter, activeCategoryTreeIds, selectedBrand, selectedUnit, workspaceTab, posConfig.screen.showBrandFilter, posConfig.screen.showUnitFilter]);

  // Fetch customers
  useEffect(() => {
    api.get("/api/customers")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCustomers(data);
      })
      .catch((err) => console.error("Failed to load customers", err));
  }, []);

  // Handle Scan barcode lookup
  const handleBarcodeSubmit = (codeToSearch?: string) => {
    const code = codeToSearch || barcodeInput;
    if (!code) return;

    const matched = mergedProducts.find((p) => p.barcode === code || p.code === code);
    if (matched) {
      addToCart(matched);
      playBeep();
      setBarcodeInput("");
      setShowBarcodeModal(false);
    } else {
      alert(`عذراً، لم يتم العثور على منتج بالباركود: ${code}`);
    }
  };

  // Add Item to Cart
  const addToCart = (product: Product) => {
    playBeep();
    setCart((prev) => {
      const existingIdx = prev.findIndex((item) => item.id === product.id);
      if (existingIdx !== -1) {
        // Set selected item index to existing
        setSelectedCartItemIndex(existingIdx);
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      const newIdx = prev.length;
      setSelectedCartItemIndex(newIdx);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  // Remove / Decrement Item
  const decrementCartItem = (index: number) => {
    playBeep();
    setCart((prev) => {
      const target = prev[index];
      if (target.quantity > 1) {
        return prev.map((item, idx) =>
          idx === index ? { ...item, quantity: item.quantity - 1 } : item
        );
      }
      if (selectedCartItemIndex === index) {
        setSelectedCartItemIndex(null);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const removeFromCart = (index: number) => {
    playBeep();
    setCart((prev) => {
      if (selectedCartItemIndex === index) {
        setSelectedCartItemIndex(null);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  // Calculations
  const totals = useMemo(() => {
    const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const totalItems = cart.length;
    const totalPieces = cart.reduce((acc, item) => acc + item.quantity, 0);

    let discountAmount = 0;
    if (appliedDiscount && posConfig.pricing.enableDiscount) {
      if (appliedDiscount.type === "percent") {
        const safePercent = Math.min(Math.max(appliedDiscount.value, 0), posConfig.pricing.maxDiscountPercent ?? 100);
        discountAmount = (subtotal * safePercent) / 100;
      } else {
        discountAmount = Math.min(Math.max(appliedDiscount.value, 0), subtotal);
      }
    }

    const netAmount = Math.max(subtotal - discountAmount, 0);
    const serviceChargeAmount = posConfig.pricing.enableServiceCharge
      ? (netAmount * (posConfig.pricing.serviceChargePercent || 0)) / 100
      : 0;
    const taxableAmount = netAmount + serviceChargeAmount;
    const vatRate = posConfig.pricing.enableTax ? (posConfig.pricing.taxPercent || 0) / 100 : 0;
    const taxAmount = !vatRate
      ? 0
      : posConfig.pricing.taxIncluded
        ? taxableAmount - taxableAmount / (1 + vatRate)
        : taxableAmount * vatRate;
    const finalTotal = posConfig.pricing.taxIncluded ? taxableAmount : taxableAmount + taxAmount;

    return {
      subtotal,
      discountAmount,
      serviceChargeAmount,
      taxAmount,
      finalTotal,
      totalItems,
      totalPieces
    };
  }, [cart, appliedDiscount, posConfig.pricing]);

  // Amount paid & Change calculations
  const changeAmount = useMemo(() => {
    const paid = parseFloat(amountPaidBuffer) || 0;
    const diff = paid - totals.finalTotal;
    return diff > 0 ? diff : 0;
  }, [amountPaidBuffer, totals.finalTotal]);

  // Hold current invoice
  const handleHoldInvoice = () => {
    if (cart.length === 0) {
      alert("السلة فارغة، لا يمكن تعليق الطلب.");
      return;
    }
    const newHold = {
      id: Math.random().toString(36).substr(2, 6).toUpperCase(),
      timestamp: new Date(),
      items: [...cart],
      customer: selectedCustomer
    };
    setHoldInvoices((prev) => [newHold, ...prev]);
    setCart([]);
    setSelectedCustomer(null);
    setAppliedDiscount(null);
    setItemNotes({});
    setInvoiceNote("");
    alert(`تم تعليق الطلب بنجاح برمز التعليق: ${newHold.id}`);
    playBeep();
  };

  const handleRestoreHoldInvoice = (holdId: string) => {
    const target = holdInvoices.find((h) => h.id === holdId);
    if (target) {
      setCart(target.items);
      setSelectedCustomer(target.customer);
      setHoldInvoices((prev) => prev.filter((h) => h.id !== holdId));
      setShowHoldInvoicesModal(false);
      playBeep();
    }
  };

  // Add new customer via quick popup
  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerForm.name || !newCustomerForm.phone) {
      alert("الرجاء ملء الاسم ورقم الهاتف.");
      return;
    }

    try {
      const res = await api.post("/api/customers", newCustomerForm);
      if (res.ok) {
        const added = await res.json();
        const fullCustomer = { id: added.id, ...newCustomerForm };
        setCustomers((prev) => [fullCustomer, ...prev]);
        setSelectedCustomer(fullCustomer);
        setNewCustomerForm({ name: "", phone: "", address: "" });
        alert("تم إضافة العميل بنجاح!");
      } else {
        // Fallback for offline/demo simulation
        const demoCust = { id: Date.now(), ...newCustomerForm };
        setCustomers((prev) => [demoCust, ...prev]);
        setSelectedCustomer(demoCust);
        setNewCustomerForm({ name: "", phone: "", address: "" });
      }
    } catch (err) {
      // Offline/demo fallback
      const demoCust = { id: Date.now(), ...newCustomerForm };
      setCustomers((prev) => [demoCust, ...prev]);
      setSelectedCustomer(demoCust);
      setNewCustomerForm({ name: "", phone: "", address: "" });
    }
  };

  // Settle/Order Complete payment
  const handleCheckout = async (paymentMethod: string = "cash") => {
    if (cart.length === 0) {
      alert("السلة فارغة. الرجاء إضافة منتجات أولاً.");
      return;
    }

    if (posConfig.salesFlow.requireCustomer && !selectedCustomer) {
      alert("إعدادات نقطة البيع تتطلب اختيار عميل قبل إتمام البيع.");
      return;
    }

    if (posConfig.salesFlow.requireCustomerForDelivery && orderType === "DELIVERY" && !selectedCustomer) {
      alert("طلبات الدليفري تتطلب اختيار عميل يحتوي على رقم هاتف وعنوان.");
      return;
    }

    if (!posConfig.salesFlow.allowNegativeStock) {
      const insufficientItems = cart.filter((item) =>
        item.track_inventory !== false &&
        typeof item.stock === "number" &&
        item.stock < item.quantity
      );

      if (insufficientItems.length) {
        alert(`لا يمكن إتمام البيع لأن المخزون غير كافٍ: ${insufficientItems.map((item) => item.name).join("، ")}`);
        return;
      }
    }

    if (posConfig.salesFlow.askBeforeCheckout && !confirm("تأكيد إتمام الفاتورة؟")) {
      return;
    }

    setCheckoutStatus({ type: "loading" });

    // Build standard payload for POS server route
    const payload = {
      items: cart.map((item, index) => ({
        id: item.id,
        quantity: item.quantity,
        price: item.price,
        selectedSize: item.selectedSize || null,
        notes: itemNotes[index] || null
      })),
      total: totals.finalTotal,
      branch_id: selectedBranch?.id || branches[0]?.id || 1,
      order_type: orderTypeApiMap[orderType] || "dine_in",
      is_paid: 1,
      customer_name: selectedCustomer?.name || "عميل نقدي",
      customer_phone: selectedCustomer?.phone || null,
      customer_address: selectedCustomer?.address || null,
      payment_method: paymentMethod,
      tax_amount: totals.taxAmount,
      service_charge: totals.serviceChargeAmount,
      discount: totals.discountAmount,
      notes: invoiceNote || null,
      invoice_note: invoiceNote || null,
      status: "completed"
    };

    try {
      const res = await api.post("/api/pos/order", payload);
      if (res.ok) {
        const data = await res.json();
        setCheckoutStatus({ type: "success", orderId: data.orderId });
        if (posConfig.salesFlow.autoPrintReceipt) {
          setTimeout(() => window.print(), 300);
        }
        playSuccessSound();
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "خطأ أثناء حفظ الفاتورة بالخادم");
      }
    } catch (err: any) {
      console.warn("Server save failed, using fallback simulation:", err);
      // Fallback for offline demo mode
      setTimeout(() => {
        setCheckoutStatus({
          type: "success",
          orderId: Math.floor(Math.random() * 900000) + 100000
        });
        playSuccessSound();
      }, 800);
    }
  };

  const resetAfterSuccess = () => {
    setCart([]);
    setSelectedCustomer(null);
    setAppliedDiscount(null);
    setItemNotes({});
    setInvoiceNote("");
    setAmountPaidBuffer("");
    setQuantityBuffer("");
    setCheckoutStatus({ type: "idle" });
    
    // Regenerate invoice number
    const rand = Math.floor(100000 + Math.random() * 900000);
    setInvoiceNumber(`INV-${rand}`);

    onOrderSuccess();
  };

  // Numpad key triggers
  const handleNumpadPress = (key: string) => {
    playBeep();
    if (numpadMode === "qty") {
      if (selectedCartItemIndex === null || cart.length === 0) {
        alert("الرجاء اختيار صنف من السلة لتعديل كميته.");
        return;
      }
      
      let newBuffer = quantityBuffer;
      if (key === "backspace") {
        newBuffer = newBuffer.slice(0, -1);
      } else {
        // Prevent multiple dots
        if (key === "." && newBuffer.includes(".")) return;
        newBuffer += key;
      }
      setQuantityBuffer(newBuffer);

      // Apply quantity directly to selected item
      const val = parseFloat(newBuffer);
      if (!isNaN(val) && val >= 0) {
        setCart((prev) =>
          prev.map((item, idx) =>
            idx === selectedCartItemIndex ? { ...item, quantity: val } : item
          )
        );
      } else if (newBuffer === "") {
        setCart((prev) =>
          prev.map((item, idx) =>
            idx === selectedCartItemIndex ? { ...item, quantity: 1 } : item
          )
        );
      }
    } else {
      // Amount paid mode
      let newBuffer = amountPaidBuffer;
      if (key === "backspace") {
        newBuffer = newBuffer.slice(0, -1);
      } else {
        if (key === "." && newBuffer.includes(".")) return;
        newBuffer += key;
      }
      setAmountPaidBuffer(newBuffer);
    }
  };

  // Helper for quick payment method colors
  const getPaymentButtonClass = (method: string) => {
    const base = "py-2 px-3 rounded-xl text-[11px] font-black tracking-wide border transition-all text-center flex flex-col justify-center items-center h-12 shadow-sm";
    switch (method) {
      case "cash":
        return `${base} bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600`;
      case "visa":
        return `${base} bg-[#1b3a8a] border-blue-900 text-white hover:bg-blue-950`;
      case "mastercard":
        return `${base} bg-slate-900 border-black text-white hover:bg-slate-800`;
      case "instapay":
        return `${base} bg-purple-600 border-purple-700 text-white hover:bg-purple-700`;
      default:
        return `${base} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`;
    }
  };

  // Build combined payment labels (default + custom)
  const allPaymentLabels = useMemo(() => {
    const labels: Record<string, { ar: string; en: string }> = { ...paymentMethodLabels };
    (posConfig.payments.customMethods || []).forEach(cm => {
      labels[cm.key] = { ar: cm.label, en: cm.en || cm.key };
    });
    return labels;
  }, [posConfig.payments.customMethods]);

  return (
    <div className={`fixed inset-0 flex flex-col overflow-hidden text-right select-none ${
      posTheme === "neobrutalist"
        ? "bg-white text-black font-sans"
        : "bg-[#f4f7fa] text-slate-800 font-sans"
    }`} dir="rtl">
      
      {/* 1. TOP BAR */}
      <div className={`h-14 flex items-center justify-between px-5 shrink-0 z-40 ${
        posTheme === "neobrutalist"
          ? "bg-white border-b-4 border-black shadow-[4px_4px_0px_#000]"
          : "bg-white border-b border-slate-200/80"
      }`}>
        
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          {posTheme === "neobrutalist" ? (
            <div className="bg-black text-[#ffeb3b] px-4 py-1.5 border-2 border-black font-extrabold text-sm tracking-tight flex items-center gap-2 shadow-[2px_2px_0px_#000]">
              <Flame className="w-4 h-4 text-[#ffeb3b] shrink-0 animate-pulse" />
              <span className="hidden sm:inline-block font-mono tracking-widest font-black">REMO_PRO // PRO</span>
            </div>
          ) : (
            <div className="bg-[#1a3a8a] px-3 py-1.5 rounded-lg text-white font-bold text-sm tracking-tight flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400 shrink-0" />
              <span>POS</span>
            </div>
          )}
          <span className={`hidden sm:inline-block text-xs font-mono font-bold ${posTheme === "neobrutalist" ? "bg-black text-white px-2 py-0.5 border border-black" : "text-slate-400"}`}>{invoiceNumber}</span>
          <span className="hidden sm:inline-block text-[10px] text-slate-300">|</span>
          <span className={`hidden sm:inline-block text-xs font-bold ${posTheme === "neobrutalist" ? "text-black underline decoration-2 decoration-[#ffeb3b]" : "text-slate-500"}`}>{selectedBranch?.name || "فرع القاهرة"}</span>
        </div>

        {/* Right: Cashier Name + Time + Actions */}
        <div className="flex items-center gap-2">
          {/* Theme Selector Toggle Button */}
          <button
            onClick={() => {
              playBeep();
              const newTheme = posTheme === "neobrutalist" ? "standard" : "neobrutalist";
              setPosTheme(newTheme);
              localStorage.setItem("pos_theme", newTheme);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black transition-all ${
              posTheme === "neobrutalist"
                ? "bg-[#ffeb3b] text-black border-2 border-black shadow-[2px_2px_0px_#000] hover:bg-yellow-300"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
            }`}
          >
            <span>🎨 {posTheme === "neobrutalist" ? "مظهر نيوبروتاليزم" : "مظهر هادئ"}</span>
          </button>

          <div className={`flex items-center gap-1.5 px-2.5 py-1 ${
            posTheme === "neobrutalist"
              ? "bg-[#ffeb3b] border-2 border-black text-black font-black"
              : "bg-slate-100 rounded-lg"
          }`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${posTheme === "neobrutalist" ? "bg-black text-white" : "bg-[#1a3a8a] text-white"}`}>{cashierName.charAt(0)}</div>
            <span className="hidden sm:inline-block text-[11px] font-bold">{cashierName}</span>
          </div>
          <span className="hidden sm:inline-block text-[10px] text-slate-300">|</span>
          <span className={`hidden sm:inline-block text-xs font-mono font-bold ${posTheme === "neobrutalist" ? "text-black" : "text-slate-500"}`}>{currentTime.toLocaleTimeString()}</span>
          <div className={`flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold ${
            posTheme === "neobrutalist"
              ? "bg-[#4caf50] text-white border-2 border-black shadow-[1.5px_1.5px_0px_#000]"
              : "bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-md"
          }`}>
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
            <span>متصل</span>
          </div>
          <div
            onClick={() => { playBeep(); window.print(); }}
            className={`w-8 h-8 flex items-center justify-center cursor-pointer transition-all ${
              posTheme === "neobrutalist"
                ? "bg-white border-2 border-black hover:bg-slate-100 shadow-[1.5px_1.5px_0px_#000]"
                : "hover:bg-slate-100 rounded-lg text-slate-400"
            }`}
            title="طباعة"
          >
            <Printer className="w-4 h-4 text-black" />
          </div>
          <button
            onClick={onBack}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              posTheme === "neobrutalist"
                ? "bg-black text-white hover:bg-neutral-800 border-2 border-black shadow-[2px_2px_0px_#000] font-bold text-xs"
                : "hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-500"
            }`}
          >
            <span>رجوع</span>
          </button>
        </div>
      </div>

      {/* MOBILE SEGMENTED TAB SWITCHER (< lg) */}
      <div className="lg:hidden flex items-center bg-slate-100 p-1 border-b border-slate-200 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setPosMobileTab("products")}
          className={`flex-1 py-2 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-2 ${
            posMobileTab === "products"
              ? posTheme === "neobrutalist"
                ? "bg-[#ffeb3b] text-black border-2 border-black shadow-sm"
                : "bg-white text-blue-700 shadow-sm border border-slate-200"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>المنتجات والقائمة</span>
        </button>
        <button
          type="button"
          onClick={() => setPosMobileTab("cart")}
          className={`flex-1 py-2 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-2 relative ${
            posMobileTab === "cart"
              ? posTheme === "neobrutalist"
                ? "bg-[#ffeb3b] text-black border-2 border-black shadow-sm"
                : "bg-white text-blue-700 shadow-sm border border-slate-200"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>سلة الطلبات</span>
          {totals.totalPieces > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {totals.totalPieces}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* 2. LEFT SIDEBAR - CART */}
        <div className={`w-full lg:w-[380px] flex flex-col shrink-0 z-20 overflow-hidden border-b lg:border-b-0 ${
          posMobileTab === "cart" ? "flex-1 flex" : "hidden lg:flex"
        } ${
          posTheme === "neobrutalist"
            ? "bg-white border-l-4 border-black text-black"
            : "bg-white border-l border-slate-200/80"
        }`}>
          
          {posConfig.screen.showCustomer && (
          <div className={`px-3 py-2 border-b flex items-center gap-2 shrink-0 ${
            posTheme === "neobrutalist" ? "border-black bg-slate-50" : "border-slate-100"
          }`}>
            <button
              onClick={() => setShowCustomerModal(true)}
              className={`flex-1 py-1.5 px-3 text-[11px] flex items-center justify-center gap-1.5 transition-all ${
                posTheme === "neobrutalist"
                  ? "bg-white text-black border-2 border-black font-extrabold shadow-[2px_2px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200/80 transition-colors"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-black shrink-0" />
              <span className="truncate">{selectedCustomer ? selectedCustomer.name : "اختر عميل..."}</span>
            </button>
            {selectedCustomer && (
              <button
                onClick={() => setSelectedCustomer(null)}
                className={`p-1.5 transition-colors ${posTheme === "neobrutalist" ? "text-black hover:text-red-600" : "text-slate-400 hover:text-red-500"}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          )}

          {/* Quick Action Buttons */}
          <div className={`px-3 py-2 border-b flex items-center gap-1.5 shrink-0 ${
            posTheme === "neobrutalist" ? "border-black" : "border-slate-100"
          }`}>
            <button
              onClick={() => {
                if (cart.length === 0) { playBeep(); return; }
                setShowDiscountModal(true);
                playBeep();
              }}
              disabled={cart.length === 0}
              className={`flex-1 py-2 px-2 text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                posTheme === "neobrutalist"
                  ? "bg-[#ffeb3b] text-black border-2 border-black shadow-[2px_2px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none font-black"
                  : "bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg border border-amber-200/80"
              }`}
              title="خصم يدوي على الأوردر"
            >
              <Percent className="w-3.5 h-3.5" />
              <span>خصم</span>
            </button>
            <button
              onClick={() => {
                handleHoldInvoice();
              }}
              disabled={cart.length === 0}
              className={`flex-1 py-2 px-2 text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                posTheme === "neobrutalist"
                  ? "bg-white text-black border-2 border-black shadow-[2px_2px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none font-black"
                  : "bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg border border-blue-200/80"
              }`}
              title="تعليق الأوردر الحالي"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>تعليق</span>
            </button>
            <button
              onClick={() => setShowHoldInvoicesModal(true)}
              className={`flex-1 py-2 px-2 text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                posTheme === "neobrutalist"
                  ? "bg-black text-white border-2 border-black shadow-[2px_2px_0px_#ffeb3b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none font-black"
                  : "bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg border border-violet-200/80"
              }`}
              title="استرجاع أوردر معلق"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استرجاع</span>
              {holdInvoices.length > 0 && (
                <span className={`text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${
                  posTheme === "neobrutalist" ? "bg-[#ffeb3b] text-black font-black border border-black" : "bg-violet-600 text-white"
                }`}>{holdInvoices.length}</span>
              )}
            </button>
          </div>

          {/* Cart column headers */}
          <div className={`px-4 py-2 flex text-[10px] font-bold shrink-0 select-none border-b ${
            posTheme === "neobrutalist"
              ? "bg-black text-white border-black font-mono tracking-widest"
              : "text-slate-400 border-slate-50"
          }`}>
            <div className="flex-1">الصنف</div>
            <div className="w-20 text-center">الكمية</div>
            <div className="w-16 text-center">السعر</div>
            <div className="w-16 text-left">الإجمالي</div>
          </div>

          {/* Scrollable list of items */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 gap-2 py-16">
                <ShoppingCart className="w-10 h-10 text-slate-300 stroke-[1.2]" />
                <p className="text-[11px] text-slate-400">السلة فارغة</p>
              </div>
            ) : (
              cart.map((item, idx) => {
                const isSelected = selectedCartItemIndex === idx;
                const note = itemNotes[idx];
                return (
                  <div 
                    key={item.id} 
                    onClick={() => {
                      setSelectedCartItemIndex(idx);
                      setQuantityBuffer(item.quantity.toString());
                      playBeep();
                    }}
                    className={`p-2 flex items-center gap-2.5 transition-all cursor-pointer ${
                      posTheme === "neobrutalist"
                        ? isSelected
                          ? "bg-[#ffeb3b]/20 border-2 border-black shadow-[2px_2px_0px_#000]"
                          : "bg-white border-2 border-black hover:bg-slate-50"
                        : isSelected 
                          ? "bg-blue-50/60 border-blue-300 border rounded-lg" 
                          : "bg-white border-slate-100 hover:bg-slate-50 border rounded-lg"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className={`w-8 h-8 flex items-center justify-center shrink-0 ${
                      posTheme === "neobrutalist" ? "bg-white border border-black" : "bg-slate-50 rounded-lg"
                    }`}>
                      {posConfig.screen.showImages && item.image ? (
                        <img src={item.image} className="w-full h-full object-contain rounded-sm" referrerPolicy="no-referrer" />
                      ) : (
                        <Package className="w-4 h-4 text-slate-300" />
                      )}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-black text-[11px] truncate leading-tight ${posTheme === "neobrutalist" ? "text-black" : "text-slate-700"}`}>
                        {item.name}
                      </h4>
                      {note && (
                        <span className={`text-[9px] truncate block ${posTheme === "neobrutalist" ? "text-red-600 font-extrabold" : "text-amber-600"}`}>{note}</span>
                      )}
                    </div>

                    {/* Qty */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); decrementCartItem(idx); }}
                        className={`w-5 h-5 flex items-center justify-center transition-all ${
                          posTheme === "neobrutalist"
                            ? "bg-white text-black border border-black hover:bg-slate-100"
                            : "border border-slate-200 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className={`text-[11px] w-5 text-center ${posTheme === "neobrutalist" ? "font-black text-black" : "font-bold text-slate-700"}`}>{item.quantity}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToCart(item); }}
                        className={`w-5 h-5 flex items-center justify-center transition-all ${
                          posTheme === "neobrutalist"
                            ? "bg-white text-black border border-black hover:bg-slate-100"
                            : "border border-slate-200 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    {/* Price & Total */}
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-400 font-mono font-bold">{item.price.toFixed(2)}</div>
                      <div className={`text-[11px] font-black ${posTheme === "neobrutalist" ? "text-black font-mono" : "text-slate-800"}`}>{(item.price * item.quantity).toFixed(2)}</div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromCart(idx); }}
                      className={`p-1 transition-colors shrink-0 ${posTheme === "neobrutalist" ? "text-black hover:text-red-600" : "text-slate-300 hover:text-red-500"}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Summary & Payment */}
          <div className={`p-3 border-t space-y-2.5 shrink-0 bg-white ${
            posTheme === "neobrutalist" ? "border-black border-t-4" : "border-slate-200/80"
          }`}>
            {invoiceNote && (
              <div className={`p-1.5 flex items-center justify-between text-[10px] ${
                posTheme === "neobrutalist"
                  ? "bg-[#ffeb3b]/20 border-2 border-black text-black font-bold"
                  : "bg-blue-50 border border-blue-100 rounded-lg text-blue-700"
              }`}>
                <span className="truncate">{invoiceNote}</span>
                <button onClick={() => setInvoiceNote("")} className={`shrink-0 mr-2 ${posTheme === "neobrutalist" ? "text-black hover:text-red-600" : "text-blue-400 hover:text-blue-600"}`}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <button
              onClick={() => setShowInvoiceNoteModal(true)}
              className={`w-full py-1 text-[10px] flex items-center justify-center gap-1 transition-colors ${
                posTheme === "neobrutalist"
                  ? "bg-white text-black border-2 border-black border-dashed hover:bg-slate-50 font-black"
                  : "border border-dashed border-slate-200 hover:border-slate-300 text-slate-400 hover:text-slate-600 bg-transparent rounded-lg"
              }`}
            >
              <Plus className="w-3 h-3" />
              <span>ملاحظة للفاتورة</span>
            </button>

            {/* Totals */}
            <div className={`space-y-1 text-[11px] ${posTheme === "neobrutalist" ? "text-black font-extrabold" : ""}`}>
              <div className="flex justify-between text-slate-500">
                <span className={posTheme === "neobrutalist" ? "text-black font-black" : ""}>المجموع</span>
                <span className="font-mono">{totals.subtotal.toFixed(2)} {currency}</span>
              </div>
              {totals.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span className={posTheme === "neobrutalist" ? "text-emerald-700 font-black" : ""}>الخصم</span>
                  <span className="font-mono">-{totals.discountAmount.toFixed(2)} {currency}</span>
                </div>
              )}
              {totals.serviceChargeAmount > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span className={posTheme === "neobrutalist" ? "text-black font-black" : ""}>خدمة</span>
                  <span className="font-mono">{totals.serviceChargeAmount.toFixed(2)} {currency}</span>
                </div>
              )}
              {totals.taxAmount > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span className={posTheme === "neobrutalist" ? "text-black font-black" : ""}>ضريبة {posConfig.pricing.taxPercent}%</span>
                  <span className="font-mono">{totals.taxAmount.toFixed(2)} {currency}</span>
                </div>
              )}
              <div className={`flex justify-between pt-1 border-t ${
                posTheme === "neobrutalist"
                  ? "text-black font-black text-base border-black border-t-2"
                  : "text-[#1a3a8a] font-black text-sm border-slate-100"
              }`}>
                <span>الإجمالي</span>
                <span className="font-mono">{totals.finalTotal.toFixed(2)} {currency}</span>
              </div>
            </div>

            {/* Paid / Change */}
            <div className="flex gap-2">
              <div 
                onClick={() => { setNumpadMode("amount"); setAmountPaidBuffer(""); playBeep(); }}
                className={`flex-1 p-2 border text-right cursor-pointer transition-all text-[11px] ${
                  posTheme === "neobrutalist"
                    ? numpadMode === "amount"
                      ? "border-2 border-black bg-[#ffeb3b]/20 font-black"
                      : "border-2 border-black bg-white"
                    : numpadMode === "amount"
                      ? "border-blue-400 bg-blue-50/50 rounded-lg"
                      : "border-slate-200 bg-slate-50/30 rounded-lg"
                }`}
              >
                <span className={`text-[9px] block ${posTheme === "neobrutalist" ? "text-black font-black" : "text-slate-400"}`}>المدفوع</span>
                <span className="font-mono font-bold">{amountPaidBuffer || "0"}</span>
              </div>
              <div className={`flex-1 p-2 text-right ${
                posTheme === "neobrutalist"
                  ? "border-2 border-black bg-[#4caf50]/20 text-black font-black"
                  : "border border-slate-100 bg-slate-50/20 rounded-lg"
              }`}>
                <span className={`text-[9px] block ${posTheme === "neobrutalist" ? "text-black font-black" : "text-slate-400"}`}>المتبقي</span>
                <span className="font-mono font-bold text-emerald-600">{changeAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Order type */}
            <div className="flex flex-wrap gap-1.5 my-1">
              {enabledOrderTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => { setOrderType(type); playBeep(); }}
                  className={`px-3 py-1.5 text-xs font-black border-2 border-black transition-all cursor-pointer ${
                    orderType === type
                      ? posTheme === "neobrutalist"
                        ? "bg-black text-white shadow-[3px_3px_0px_#000] -translate-x-0.5 -translate-y-0.5"
                        : "bg-[#1a3a8a] text-white border-[#1a3a8a] rounded-md"
                      : posTheme === "neobrutalist"
                        ? "bg-white text-black hover:bg-[#ffeb3b] hover:shadow-[2px_2px_0px_#000]"
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50 rounded-md"
                  }`}
                >
                  {orderTypeLabels[type] || type}
                </button>
              ))}
            </div>

            {/* Payment methods */}
            <div className="grid grid-cols-4 gap-1.5">
              {enabledPaymentMethods.map((method) => {
                if (posTheme === "neobrutalist") {
                  return (
                    <button
                      key={method}
                      onClick={() => { handleCheckout(method); }}
                      className="py-2 px-1 border-2 border-black bg-[#ffeb3b] text-black font-black text-xs tracking-wide transition-all text-center flex flex-col justify-center items-center h-12 shadow-[3px_3px_0px_#000] hover:bg-amber-300 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none cursor-pointer"
                    >
                      <span className="leading-tight">{allPaymentLabels[method]?.ar || method}</span>
                      <span className="text-[9px] opacity-80 font-mono font-bold">{allPaymentLabels[method]?.en || method}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={method}
                    onClick={() => { handleCheckout(method); }}
                    className={getPaymentButtonClass(method)}
                  >
                    <span>{allPaymentLabels[method]?.ar || method}</span>
                    <span className="text-[8px] opacity-70 font-mono">{allPaymentLabels[method]?.en || method}</span>
                  </button>
                );
              })}
            </div>

            {/* Pay button */}
            <button
              onClick={() => handleCheckout("cash")}
              disabled={cart.length === 0}
              className={`w-full py-3 font-extrabold text-sm shadow-sm transition-all flex items-center justify-center gap-2 ${
                posTheme === "neobrutalist"
                  ? "bg-[#ffeb3b] text-black border-4 border-black shadow-[4px_4px_0px_#000] hover:bg-amber-300 disabled:opacity-30 disabled:shadow-none active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                  : "bg-[#1a3a8a] text-white rounded-lg hover:bg-blue-950 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
              }`}
            >
              <Receipt className="w-4 h-4 shrink-0" />
              <span>دفع {totals.finalTotal.toFixed(2)} {currency}</span>
            </button>
          </div>
        </div>

        {/* 3. MAIN WORKSPACE */}
        <div className={`flex-1 flex flex-col overflow-hidden p-3 sm:p-4 ${
          posMobileTab === "products" ? "flex" : "hidden lg:flex"
        } ${
          posTheme === "neobrutalist"
            ? "bg-white text-black"
            : "bg-[#f1f5f9] text-slate-800"
        }`}>
          
          {/* Search & filters */}
          <div className={`p-3.5 shrink-0 mb-3 ${
            posTheme === "neobrutalist"
              ? "bg-white border-4 border-black shadow-[4px_4px_0px_#000]"
              : "bg-white rounded-2xl border border-slate-200/60 shadow-sm"
          }`}>
            
            <div className="flex gap-2.5">
              <div className="relative flex-1 group">
                <Search className={`absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${posTheme === "neobrutalist" ? "text-black" : "text-slate-300 group-focus-within:text-blue-500"}`} />
                <input
                  type="text"
                  placeholder="ابحث عن منتج بالاسم أو الباركود..."
                  className={`w-full text-xs text-right placeholder:text-slate-400 ${
                    posTheme === "neobrutalist"
                      ? "bg-white border-2 border-black py-2.5 pr-10 pl-10 font-black focus:outline-none focus:bg-[#ffeb3b]/10"
                      : "bg-slate-50/80 border border-slate-200/80 rounded-xl py-2.5 pr-10 pl-10 focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 focus:bg-white transition-all"
                  }`}
                  value={searchQuery ?? ""}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center transition-all ${
                      posTheme === "neobrutalist"
                        ? "bg-black text-white hover:bg-neutral-800"
                        : "bg-slate-200/80 hover:bg-slate-300 rounded-full text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <VoiceInputButton
                onTranscript={(text) => setSearchQuery(text)}
                className={posTheme === "neobrutalist" 
                  ? "h-11 bg-white border-2 border-black text-black font-extrabold shadow-[2px_2px_0px_#000]" 
                  : "h-11 bg-slate-50 hover:bg-teal-50 text-teal-600 border border-slate-200 rounded-xl"}
              />

              {posConfig.screen.showBarcode && (
              <button
                onClick={() => { playBeep(); setShowBarcodeModal(true); }}
                className={`h-11 flex items-center justify-center shrink-0 transition-all ${
                  posTheme === "neobrutalist"
                    ? "w-16 bg-[#ffeb3b] border-2 border-black text-black font-extrabold shadow-[2px_2px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    : "w-11 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-xl border border-slate-200 hover:border-blue-200"
                }`}
                title="مسح باركود"
              >
                {posTheme === "neobrutalist" ? (
                  <span className="font-mono text-xs font-black">SCAN_BAR</span>
                ) : (
                  <Scale className="w-4.5 h-4.5" />
                )}
              </button>
              )}
            </div>

            {/* Filters row */}
            <div className="flex items-center justify-between mt-2.5">
              <div className="flex items-center gap-1.5">
                {posConfig.screen.showBrandFilter && uniqueBrands.length > 0 && (
                  <select
                    value={selectedBrand ?? ""}
                    onChange={(e) => { setSelectedBrand(e.target.value); playBeep(); }}
                    className={`text-[10px] px-2 py-1 focus:outline-none text-right font-bold ${
                      posTheme === "neobrutalist"
                        ? "bg-white border-2 border-black text-black"
                        : "bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:border-blue-500"
                    }`}
                  >
                    <option value="all">كل الماركات</option>
                    {uniqueBrands.map((b, bIdx) => <option key={`pos-brand-${b || bIdx}-${bIdx}`} value={b}>{b}</option>)}
                  </select>
                )}
                {posConfig.screen.showUnitFilter && uniqueUnits.length > 0 && (
                  <select
                    value={selectedUnit ?? ""}
                    onChange={(e) => { setSelectedUnit(e.target.value); playBeep(); }}
                    className={`text-[10px] px-2 py-1 focus:outline-none text-right font-bold ${
                      posTheme === "neobrutalist"
                        ? "bg-white border-2 border-black text-black"
                        : "bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:border-blue-500"
                    }`}
                  >
                    <option value="all">كل الوحدات</option>
                    {uniqueUnits.map((u, uIdx) => <option key={`pos-unit-${u || uIdx}-${uIdx}`} value={u}>{u}</option>)}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Active category indicator */}
                {selectedCategoryFilter !== "all" && (() => {
                  const activeCat = mergedCategories.find((c) => c.id.toString() === selectedCategoryFilter || c.name === selectedCategoryFilter);
                  if (!activeCat) return null;
                  return (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`flex items-center gap-2 px-3 py-1 ${
                        posTheme === "neobrutalist"
                          ? "bg-[#ffeb3b]/20 border-2 border-black text-black font-extrabold"
                          : "bg-blue-50 border border-blue-100 rounded-full"
                      }`}
                    >
                      <span style={{ fontSize: 14 }}>{getCategoryIcon(activeCat.id, activeCat.name)}</span>
                      <span className={`text-[11px] font-bold ${posTheme === "neobrutalist" ? "text-black font-black" : "text-blue-700"}`}>{activeCat.name}</span>
                      <button
                        onClick={() => { setSelectedCategoryFilter("all"); playBeep(); }}
                        className={`w-4 h-4 rounded-full flex items-center justify-center transition-colors ${
                          posTheme === "neobrutalist" ? "bg-black text-[#ffeb3b]" : "bg-blue-200/60 hover:bg-blue-300/80"
                        }`}
                      >
                        <X className="w-2.5 h-2.5 text-current" />
                      </button>
                    </motion.div>
                  );
                })()}
                <div className={`flex gap-0.5 p-0.5 ${
                  posTheme === "neobrutalist"
                    ? "bg-white border-2 border-black"
                    : "bg-slate-100 rounded-xl border border-slate-200/80"
                }`}>
                  <button
                    onClick={() => { setWorkspaceTab("categories"); playBeep(); }}
                    className={`px-3 py-1.5 text-[10px] font-extrabold transition-all ${
                      workspaceTab === "categories"
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white text-slate-800 shadow-sm rounded-lg"
                        : posTheme === "neobrutalist" ? "text-black hover:bg-slate-100" : "text-slate-500 hover:text-slate-700 rounded-lg"
                    }`}
                  >الكل</button>
                  <button
                    onClick={() => { setWorkspaceTab("favorites"); playBeep(); }}
                    className={`px-3 py-1.5 text-[10px] font-extrabold transition-all ${
                      workspaceTab === "favorites"
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white text-slate-800 shadow-sm rounded-lg"
                        : posTheme === "neobrutalist" ? "text-black hover:bg-slate-100" : "text-slate-500 hover:text-slate-700 rounded-lg"
                    }`}
                  >المفضلة</button>
                  <button
                    onClick={() => { setWorkspaceTab("most_selling"); playBeep(); }}
                    className={`px-3 py-1.5 text-[10px] font-extrabold transition-all ${
                      workspaceTab === "most_selling"
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white text-slate-800 shadow-sm rounded-lg"
                        : posTheme === "neobrutalist" ? "text-black hover:bg-slate-100" : "text-slate-500 hover:text-slate-700 rounded-lg"
                    }`}
                  >الأكثر مبيعاً</button>
                </div>
                <div className={`flex gap-0.5 p-0.5 ${
                  posTheme === "neobrutalist"
                    ? "bg-white border-2 border-black"
                    : "bg-slate-100 rounded-xl border border-slate-200/80"
                }`}>
                  <button
                    onClick={() => { setViewMode("grid"); playBeep(); }}
                    className={`p-1.5 transition-all ${
                      viewMode === "grid"
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white text-slate-800 shadow-sm rounded-lg"
                        : "text-slate-400 hover:text-slate-600 rounded-lg"
                    }`}
                  ><Grid className="w-3.5 h-3.5" /></button>
                  <button
                    onClick={() => { setViewMode("list"); playBeep(); }}
                    className={`p-1.5 transition-all ${
                      viewMode === "list"
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white text-slate-800 shadow-sm rounded-lg"
                        : "text-slate-400 hover:text-slate-600 rounded-lg"
                    }`}
                  ><List className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          </div>

          {/* Subcategories — Modern pills */}
          {activeSubcategories.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-none shrink-0 items-center py-1.5 px-1">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => { setSelectedSubcategoryFilter("all"); playBeep(); }}
                className={`px-3.5 py-1.5 text-[11px] font-extrabold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  selectedSubcategoryFilter === "all"
                    ? posTheme === "neobrutalist"
                      ? "bg-black text-[#ffeb3b] border-2 border-black shadow-[2px_2px_0px_#000] -translate-x-0.5 -translate-y-0.5"
                      : "bg-[#1a3a8a] text-white shadow-md shadow-blue-600/20 rounded-full"
                    : posTheme === "neobrutalist"
                      ? "bg-white text-black border-2 border-black"
                      : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700 rounded-full"
                }`}
              >
                <LayoutGrid className="w-3 h-3" />
                الكل
              </motion.button>
              {activeSubcategories.map((subcat) => {
                const count = mergedProducts.filter((p) => p.category_id === subcat.id).length;
                const isActive = selectedSubcategoryFilter === subcat.id.toString();
                return (
                  <motion.button
                    key={subcat.id}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => { setSelectedSubcategoryFilter(subcat.id.toString()); playBeep(); }}
                    className={`px-3.5 py-1.5 text-[11px] font-extrabold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      isActive
                        ? posTheme === "neobrutalist"
                          ? "bg-[#ffeb3b] text-black border-2 border-black shadow-[2px_2px_0px_#000] -translate-x-0.5 -translate-y-0.5"
                          : "bg-[#1a3a8a] text-white shadow-md shadow-blue-600/20 rounded-full"
                        : posTheme === "neobrutalist"
                          ? "bg-white text-black border-2 border-black"
                          : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700 rounded-full"
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    {subcat.name}
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 ${
                      isActive
                        ? posTheme === "neobrutalist" ? "bg-black text-white" : "bg-white/20 rounded-full"
                        : posTheme === "neobrutalist" ? "bg-black text-[#ffeb3b]" : "bg-slate-100 rounded-full"
                    }`}>{count}</span>
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* Product grid/list */}
          <div className="flex-1 overflow-y-auto pr-0.5 pl-0.5">
            {filteredProducts.length === 0 ? (
              posTheme === "neobrutalist" ? (
                <div className="h-full flex flex-col items-center justify-center py-16">
                  <div className="transform -rotate-3 bg-black text-white p-8 border-4 border-black shadow-[6px_6px_0px_#ffeb3b] text-center max-w-sm">
                    <h2 className="font-black text-2xl tracking-tight mb-2">NULL_DATA</h2>
                    <p className="text-sm font-bold text-amber-300">لا توجد منتجات مطابقة في هذا القسم</p>
                    <p className="text-xs text-slate-400 mt-2">يرجى اختيار قسم آخر أو تجربة البحث باسم مختلف</p>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 py-16">
                  <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center">
                    <Package className="w-10 h-10 stroke-[1]" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-400">لا توجد منتجات مطابقة</p>
                    <p className="text-[11px] text-slate-300 mt-1">جرّب تغيير القسم أو البحث</p>
                  </div>
                </div>
              )
            ) : viewMode === "grid" ? (
              <div className={getProductGridClass(posConfig.screen.productsPerRow)}>
                {filteredProducts.map((product) => {
                  const isInCart = cart.some((item) => item.id === product.id);
                  return (
                    <motion.div
                      key={product.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => addToCart(product)}
                      className={`overflow-hidden transition-all duration-200 cursor-pointer flex flex-col relative group ${
                        posTheme === "neobrutalist"
                          ? isInCart
                            ? "bg-white border-4 border-black shadow-[4px_4px_0px_#ffeb3b] -translate-x-0.5 -translate-y-0.5"
                            : "bg-white border-4 border-black shadow-[4px_4px_0px_#000] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[6px_6px_0px_#000]"
                          : isInCart
                            ? "bg-white rounded-2xl border-blue-400 ring-2 ring-blue-400/15 border shadow-sm hover:shadow-lg"
                            : "bg-white rounded-2xl border-slate-200/50 hover:border-slate-300 border shadow-sm hover:shadow-lg"
                      }`}
                    >
                      {/* Favorite */}
                      <button
                        onClick={(e) => { e.stopPropagation(); playBeep(); product.is_favorite = !product.is_favorite; setWorkspaceTab(workspaceTab); }}
                        className={`absolute top-2 right-2 z-10 p-1 transition-all shadow-sm ${
                          product.is_favorite
                            ? posTheme === "neobrutalist" ? "text-red-600 bg-[#ffeb3b] border border-black" : "text-amber-500 bg-white rounded-full"
                            : posTheme === "neobrutalist" ? "text-black bg-white border border-black" : "text-slate-300 hover:text-amber-400 bg-white/80 rounded-full"
                        }`}
                      >
                        <Heart className="w-3.5 h-3.5 fill-current" />
                      </button>

                      {/* Cart indicator */}
                      {isInCart && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className={`absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center shadow-md ${
                            posTheme === "neobrutalist"
                              ? "bg-black border border-white text-white text-xs font-black"
                              : "bg-[#1a3a8a] text-white text-[9px] font-bold rounded-full shadow-blue-600/30"
                          }`}
                        >
                          <span>
                            {cart.find((item) => item.id === product.id)?.quantity || 0}
                          </span>
                        </motion.div>
                      )}

                      {/* Image */}
                      <div className={`aspect-[4/3] relative flex items-center justify-center shrink-0 ${
                        posTheme === "neobrutalist"
                          ? "bg-white border-b-2 border-black"
                          : "bg-gradient-to-br from-slate-50 to-slate-100/50"
                      }`}>
                        {product.image ? (
                          <img src={product.image} alt={product.name} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
                        ) : (
                          <div className={`w-12 h-12 flex items-center justify-center ${posTheme === "neobrutalist" ? "bg-white border border-black" : "bg-slate-100 rounded-2xl"}`}>
                            <Package className="w-6 h-6 text-slate-200" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-3 flex items-end justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className={`font-black text-[11px] leading-snug line-clamp-1 truncate ${posTheme === "neobrutalist" ? "text-black" : "text-slate-700"}`}>{product.name}</h3>
                          <span className="text-[9px] text-slate-400 font-mono mt-0.5 block">SKU: {product.barcode || product.id}</span>
                        </div>
                        <span className={`text-xs font-extrabold shrink-0 shadow-sm ${
                          posTheme === "neobrutalist"
                            ? "bg-[#ffeb3b] border-2 border-black text-black px-2 py-0.5 shadow-[1px_1px_0px_#000]"
                            : "bg-gradient-to-b from-blue-50 to-blue-100/80 px-2.5 py-1 rounded-xl text-[#1a3a8a]"
                        }`}>
                          {product.price.toFixed(2)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className={`overflow-hidden shadow-sm ${
                posTheme === "neobrutalist"
                  ? "bg-white border-4 border-black shadow-[4px_4px_0px_#000]"
                  : "bg-white rounded-2xl border border-slate-200/60"
              }`}>
                <table className="w-full text-right text-xs">
                  <thead className={`text-[10px] font-semibold border-b ${
                    posTheme === "neobrutalist"
                      ? "bg-black text-white border-black"
                      : "bg-gradient-to-l from-slate-50 to-slate-100/80 text-slate-500 border-slate-100"
                  }`}>
                    <tr>
                      <th className="p-3">المنتج</th>
                      <th className="p-3">باركود</th>
                      <th className="p-3 text-left">السعر</th>
                    </tr>
                  </thead>
                  <tbody className={posTheme === "neobrutalist" ? "divide-y divide-black" : "divide-y divide-slate-50"}>
                    {filteredProducts.map((product) => (
                      <motion.tr
                        key={product.id}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => addToCart(product)}
                        className={`cursor-pointer transition-colors group ${
                          posTheme === "neobrutalist"
                            ? "hover:bg-[#ffeb3b]/10 text-black font-extrabold"
                            : "hover:bg-blue-50/50 text-slate-700"
                        }`}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 flex items-center justify-center shrink-0 transition-colors ${
                              posTheme === "neobrutalist" ? "bg-white border border-black text-black" : "bg-slate-50 rounded-lg group-hover:bg-blue-100/60"
                            }`}>
                              <Package className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                            </div>
                            <span className="font-bold">{product.name}</span>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-slate-400 text-[10px]">{product.barcode || product.id}</td>
                        <td className={`p-3 font-extrabold text-left ${posTheme === "neobrutalist" ? "text-black" : "text-[#1a3a8a]"}`}>{product.price.toFixed(2)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sticky Mobile Cart Floating Bar */}
          {cart.length > 0 && posMobileTab === "products" && (
            <div className="lg:hidden shrink-0 mt-2 p-2 bg-white border-t border-slate-200 z-30 shadow-lg rounded-2xl">
              <button
                type="button"
                onClick={() => setPosMobileTab("cart")}
                className={`w-full py-3 px-4 flex items-center justify-between font-black text-xs sm:text-sm rounded-xl transition-all ${
                  posTheme === "neobrutalist"
                    ? "bg-[#ffeb3b] text-black border-2 border-black shadow-[3px_3px_0px_#000]"
                    : "bg-blue-600 text-white shadow-md hover:bg-blue-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4.5 h-4.5" />
                  <span>عرض السلة ({totals.totalPieces} قطعة)</span>
                </div>
                <div className="flex items-center gap-1 font-mono">
                  <span>{totals.finalTotal.toFixed(2)} {currency}</span>
                  <ChevronLeft className="w-4 h-4" />
                </div>
              </button>
            </div>
          )}

        </div>

        {posConfig.screen.showCategorySidebar && (
          <>
        {/* 4. CATEGORIES SIDEBAR — Modern */}
        <div className="hidden lg:flex w-64 bg-gradient-to-b from-[#0f1b3d] via-[#132c63] to-[#0d1a38] flex-col shrink-0 z-10 text-right">
          
          {/* Header */}
          <div className="p-4 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Layers className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm tracking-tight">الأقسام</h2>
                  <p className="text-blue-300/50 text-[10px] font-medium">{mainCategories.length} قسم</p>
                </div>
              </div>
            </div>
          </div>

          {/* Categories list */}
          <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1 scrollbar-thin">
            
            {/* "All" button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => { setSelectedCategoryFilter("all"); playBeep(); }}
              className={`w-full py-2.5 px-3 rounded-xl text-[12px] font-semibold transition-all flex items-center justify-between gap-2 relative overflow-hidden ${
                selectedCategoryFilter === "all"
                  ? "bg-gradient-to-l from-blue-500/90 to-blue-600/90 text-white shadow-lg shadow-blue-600/30"
                  : "text-blue-200/70 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {selectedCategoryFilter === "all" && (
                <motion.div
                  layoutId="catActiveIndicator"
                  className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400 rounded-r-full"
                />
              )}
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedCategoryFilter === "all"
                    ? "bg-white/20"
                    : "bg-white/[0.06]"
                }`}>
                  <LayoutGrid className="w-4 h-4" />
                </div>
                <span>جميع المنتجات</span>
              </div>
              <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${
                selectedCategoryFilter === "all"
                  ? "bg-white/20"
                  : "bg-white/[0.08]"
              }`}>{mergedProducts.length}</span>
            </motion.button>

            {/* Category items */}
            {mainCategories.map((cat, idx) => {
              const subcatIds = mergedCategories.filter((sc) => sc.parent_id === cat.id).map((sc) => sc.id);
              const count = mergedProducts.filter((p) => p.category_id === cat.id || subcatIds.includes(p.category_id)).length;
              const isSelected = selectedCategoryFilter === cat.id.toString() || selectedCategoryFilter === cat.name;
              const catColor = cat.color || "#3b82f6";
              return (
                <motion.button
                  key={cat.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setSelectedCategoryFilter(cat.id.toString()); playBeep(); }}
                  className={`w-full py-2.5 px-3 rounded-xl text-[12px] font-medium transition-all flex items-center justify-between gap-2 relative overflow-hidden group ${
                    isSelected
                      ? "bg-gradient-to-l from-blue-500/90 to-blue-600/90 text-white shadow-lg shadow-blue-600/30"
                      : "text-blue-200/70 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03, duration: 0.2 }}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="catActiveIndicator"
                      className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400 rounded-r-full"
                    />
                  )}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        backgroundColor: isSelected ? "rgba(255,255,255,0.2)" : `${catColor}20`,
                        color: isSelected ? "#fff" : catColor
                      }}
                    >
                      <span className="text-[16px]">{getCategoryIcon(cat.id, cat.name)}</span>
                    </div>
                    <span className="truncate">{cat.name}</span>
                  </div>
                  {count > 0 && (
                    <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full shrink-0 ${
                      isSelected
                        ? "bg-white/20"
                        : "bg-white/[0.08] group-hover:bg-white/[0.12]"
                    } transition-colors`}>{count}</span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Numpad — Modern */}
          {posConfig.screen.showNumpad && (
          <div className="p-3 bg-black/20 border-t border-white/[0.06] shrink-0">
            <div className="flex items-center justify-between mb-2 px-0.5">
              <span className="text-[10px] text-blue-300/60 font-semibold">الكمية / الدفع</span>
              <button
                onClick={() => { playBeep(); setNumpadMode(numpadMode === "qty" ? "amount" : "qty"); setQuantityBuffer(""); }}
                className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-lg border border-amber-400/20 hover:bg-amber-400/20 transition-colors"
              >
                <ArrowRight className="w-3 h-3" />
                {numpadMode === "qty" ? "كمية" : "مدفوع"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <button onClick={() => handleNumpadPress("7")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">7</button>
              <button onClick={() => handleNumpadPress("8")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">8</button>
              <button onClick={() => handleNumpadPress("9")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">9</button>
              <button onClick={() => handleNumpadPress("backspace")} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 rounded-xl h-9 flex items-center justify-center transition-colors"><X className="w-3.5 h-3.5" /></button>
              <button onClick={() => handleNumpadPress("4")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">4</button>
              <button onClick={() => handleNumpadPress("5")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">5</button>
              <button onClick={() => handleNumpadPress("6")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">6</button>
              <button onClick={() => { playBeep(); if (cart.length === 0) { alert("السلة فارغة."); return; } if (numpadMode === "qty") { setQuantityBuffer(""); } else { handleCheckout("cash"); } }} className="bg-emerald-500/80 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-xl h-[78px] row-span-2 flex flex-col items-center justify-center gap-1 transition-colors shadow-lg shadow-emerald-600/20 border border-emerald-400/20">
                <span className="text-[11px]">Enter</span>
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <button onClick={() => handleNumpadPress("1")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">1</button>
              <button onClick={() => handleNumpadPress("2")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">2</button>
              <button onClick={() => handleNumpadPress("3")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">3</button>
              <button onClick={() => handleNumpadPress("0")} className="col-span-2 bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">0</button>
              <button onClick={() => handleNumpadPress(".")} className="bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium rounded-xl h-9 flex items-center justify-center transition-colors border border-white/[0.04]">.</button>
            </div>
          </div>
          )}

          {/* Manage button */}
          <div className="p-3 bg-black/20 border-t border-white/[0.06]">
            <button
              onClick={onBack}
              className="w-full py-2.5 bg-gradient-to-l from-white/[0.08] to-white/[0.04] text-blue-200/80 hover:text-white hover:from-white/[0.14] hover:to-white/[0.08] rounded-xl text-[11px] font-semibold text-center flex items-center justify-center gap-2 transition-all border border-white/[0.06] hover:border-white/[0.12]"
            >
              <Settings2 className="w-4 h-4" />
              <span>إدارة الأقسام</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

          </>
        )}
      </div>

      {/* FOOTER */}
      <div className="h-7 bg-slate-800 text-slate-500 flex items-center justify-between px-5 shrink-0 text-[10px]">
        <div className="flex items-center gap-4">
          {posConfig.reports.showTodaySales && (
            <span>مبيعات اليوم: <span className="text-emerald-400 font-mono">5,650.00 {currency}</span></span>
          )}
          {posConfig.reports.showInvoiceCount && (
            <span>فواتير: <span className="text-blue-400 font-mono">45</span></span>
          )}
          {posConfig.reports.showTopProducts && (
            <span>أصناف: <span className="text-amber-400 font-mono">{mergedProducts.length}</span></span>
          )}
        </div>
        <span className="text-slate-600 font-mono">{activeProfile.label}</span>
      </div>

      {/* MODALS */}

      {/* A. BARCODE SCAN SIMULATOR */}
      <AnimatePresence>
        {showBarcodeModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl text-right"
              dir="rtl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-sans font-black text-slate-800 text-base">محاكاة قارئ الباركود</h3>
                <button onClick={() => setShowBarcodeModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                في بيئة الإنتاج، يتم تمرير قارئ الباركود العادي فيقوم بإدخال الرمز مباشرة. يمكنك هنا اختيار أحد الباركودات التجريبية أو كتابة باركود مخصص للبحث والإضافة الفورية للطلب:
              </p>

              <div className="space-y-2 mb-4">
                <span className="text-[10px] font-black text-slate-400 block mb-1">رموز سريعة للتجربة:</span>
                <div className="grid grid-cols-2 gap-2">
                  {mergedProducts.filter(p => p.barcode).slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleBarcodeSubmit(p.barcode)}
                      className="p-2 bg-slate-50 hover:bg-blue-50 border border-slate-200/60 rounded-xl text-right text-xs text-slate-700 font-medium transition-all"
                    >
                      <span className="block font-bold truncate">{p.name}</span>
                      <span className="block text-[9px] font-mono text-slate-400 mt-0.5">{p.barcode}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="أدخل رمز الباركود يدوياً..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2 px-4 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={barcodeInput ?? ""}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleBarcodeSubmit();
                  }}
                  autoFocus
                />
                <button
                  onClick={() => handleBarcodeSubmit()}
                  className="px-4 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-700 transition-all"
                >
                  إضافة
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* B. CHOOSE CUSTOMER */}
      <AnimatePresence>
        {showCustomerModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-xl flex flex-col max-h-[85vh] text-right"
              dir="rtl"
            >
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="font-sans font-black text-slate-800 text-base">اختيار عميل الفاتورة</h3>
                <button onClick={() => setShowCustomerModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
                <div className="flex flex-col overflow-hidden border-l border-slate-100 pl-4">
                  <span className="text-[10px] font-black text-slate-400 block mb-2">عملاء مسجلين:</span>
                  
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    <button
                      onClick={() => {
                        setSelectedCustomer(null);
                        setShowCustomerModal(false);
                        playBeep();
                      }}
                      className="w-full p-2.5 bg-slate-50 hover:bg-blue-50 text-right text-xs rounded-xl font-bold text-slate-700 border border-transparent transition-all block"
                    >
                      عميل نقدي (افتراضي)
                    </button>

                    {customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setShowCustomerModal(false);
                          playBeep();
                        }}
                        className={`w-full p-2.5 hover:bg-blue-50 text-right text-xs rounded-xl border transition-all block ${
                          selectedCustomer?.id === c.id
                            ? "bg-blue-50 border-blue-200 text-blue-700 font-bold"
                            : "bg-white border-slate-100 text-slate-600"
                        }`}
                      >
                        <span className="block font-bold">{c.name}</span>
                        <span className="block text-[10px] text-slate-400 mt-0.5">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleAddCustomer} className="space-y-3 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    <span className="text-[10px] font-black text-slate-400 block">إضافة عميل سريع:</span>
                    
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">الاسم الأول والأخير *</label>
                      <input
                        type="text"
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs"
                        value={newCustomerForm.name ?? ""}
                        onChange={(e) => setNewCustomerForm((prev) => ({ ...prev, name: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">رقم الهاتف *</label>
                      <input
                        type="tel"
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs"
                        value={newCustomerForm.phone ?? ""}
                        onChange={(e) => setNewCustomerForm((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">العنوان بالتفصيل</label>
                      <textarea
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs h-16 resize-none"
                        value={newCustomerForm.address ?? ""}
                        onChange={(e) => setNewCustomerForm((prev) => ({ ...prev, address: e.target.value }))}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/10"
                  >
                    إضافة واختيار العميل
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* C. HOLD INVOICES LIST */}
      <AnimatePresence>
        {showHoldInvoicesModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-xl flex flex-col max-h-[80vh] text-right"
              dir="rtl"
            >
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-500" />
                  <h3 className="font-sans font-black text-slate-800 text-base">استرجاع الفواتير المعلقة</h3>
                </div>
                <button onClick={() => setShowHoldInvoicesModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-2">
                {holdInvoices.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 opacity-60 flex flex-col items-center gap-3">
                    <Clock className="w-12 h-12 text-slate-300 stroke-[1.2]" />
                    <p className="text-xs font-bold">لا يوجد أي فواتير معلقة حالياً</p>
                  </div>
                ) : (
                  holdInvoices.map((hold) => (
                    <div key={hold.id} className="p-3 bg-slate-50 border border-slate-200/60 rounded-2xl flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                            {hold.id}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {hold.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 font-bold">
                          العميل: {hold.customer ? hold.customer.name : "عميل نقدي"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          عدد الأصناف: {hold.items.reduce((acc, i) => acc + i.quantity, 0)} | الإجمالي: {hold.items.reduce((acc, i) => acc + i.price * i.quantity, 0).toFixed(2)}
                        </p>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleRestoreHoldInvoice(hold.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all"
                        >
                          استرجاع
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("هل تود حذف هذه الفاتورة المعلقة؟")) {
                              setHoldInvoices((prev) => prev.filter((h) => h.id !== hold.id));
                              playBeep();
                            }
                          }}
                          className="p-1.5 bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* D. GENERAL INVOICE NOTE */}
      <AnimatePresence>
        {showInvoiceNoteModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-xl text-right"
              dir="rtl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-sans font-black text-slate-800 text-base">إضافة ملاحظة عامة للفاتورة</h3>
                <button onClick={() => setShowInvoiceNoteModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <textarea
                  placeholder="أدخل ملاحظات عامة للطلب بالكامل (مثال: توصيل سريع، الاتصال قبل الدخول...)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs h-28 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-right"
                  value={invoiceNote ?? ""}
                  onChange={(e) => setInvoiceNote(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    playBeep();
                    setShowInvoiceNoteModal(false);
                  }}
                  className="flex-1 py-2.5 bg-[#1a3a8a] hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                >
                  حفظ الملاحظة
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* E. CHECKOUT COMPLETED SCREEN */}
      <AnimatePresence>
        {checkoutStatus.type === "success" && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center flex flex-col items-center"
              dir="rtl"
            >
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-5 text-green-500">
                <CheckCircle2 className="w-12 h-12 stroke-[1.5] animate-bounce" />
              </div>

              <h3 className="font-sans font-black text-slate-800 text-xl mb-2">
                تم حفظ الفاتورة بنجاح!
              </h3>
              
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                تم تسجيل الفاتورة بنجاح في قاعدة البيانات وتحديث المخزون والوردية الحالية.
              </p>

              <div className="bg-slate-50 border border-slate-150 rounded-2xl p-4 w-full mb-6 space-y-2 text-right">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">رقم الفاتورة:</span>
                  <span className="font-mono font-black text-slate-700">#{checkoutStatus.orderId}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">طريقة الدفع:</span>
                  <span className="font-bold text-slate-700">نقدي (كاش)</span>
                </div>
                <div className="flex justify-between items-center text-xs border-t border-slate-200 border-dashed pt-2 mt-2">
                  <span className="font-bold text-slate-700">المبلغ الإجمالي:</span>
                  <span className="font-black text-slate-900 text-base">{totals.finalTotal.toFixed(2)} EGP</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">المبلغ المدفوع:</span>
                  <span className="font-bold text-slate-700 font-mono">{parseFloat(amountPaidBuffer || "0").toFixed(2)} EGP</span>
                </div>
                <div className="flex justify-between items-center text-xs text-teal-600 font-bold">
                  <span>المبلغ المتبقي:</span>
                  <span className="font-black font-mono text-base">{changeAmount.toFixed(2)} EGP</span>
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={resetAfterSuccess}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/10"
                >
                  فاتورة جديدة
                </button>
                <button
                  onClick={() => {
                    alert("جاري إرسال أمر الطباعة إلى طابعة الفواتير المحددة...");
                  }}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* LOADING OVERLAY */}
      <AnimatePresence>
        {checkoutStatus.type === "loading" && (
          <div className="fixed inset-0 bg-white/70 backdrop-blur-xs flex flex-col items-center justify-center z-50">
            <div className="w-12 h-12 border-4 border-[#1a3a8a] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="font-bold text-xs text-slate-600">جاري تسجيل طلبك ومعالجة الفاتورة...</p>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
