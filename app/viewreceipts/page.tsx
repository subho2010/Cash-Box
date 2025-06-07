"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Search, Filter, X } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Receipt {
  id: string | number
  receiptNumber: string
  date: string
  customerName: string
  total: number | string
  paymentStatus: "full" | "advance" | "due"
}

export default function ViewReceipts() {
  const router = useRouter()
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "full" | "advance" | "due">("all")
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    const checkAuthAndFetchReceipts = async () => {
      try {
        const userJSON = localStorage.getItem("currentUser")
        if (!userJSON) {
          router.push("/login")
          return
        }

        const user = JSON.parse(userJSON)
        if (!user?.token) {
          throw new Error("Invalid user session")
        }

        const response = await fetch("/api/viewreceipts", {
          headers: {
            Authorization: `Bearer ${user.token}`
          }
        })

        if (!response.ok) {
          throw new Error(response.status === 401 ? "Session expired" : "Failed to fetch receipts")
        }
        
        const data = await response.json()
        const processedReceipts = data.map((receipt: Receipt) => ({
          ...receipt,
          total: typeof receipt.total === 'string' ? parseFloat(receipt.total) : receipt.total
        }))
        setReceipts(processedReceipts)
      } catch (err) {
        console.error("Error:", err)
        setError(err instanceof Error ? err.message : "An unknown error occurred")
        if (err instanceof Error && err.message === "Session expired") {
          localStorage.removeItem("currentUser")
          router.push("/login")
        }
      } finally {
        setLoading(false)
      }
    }

    checkAuthAndFetchReceipts()
  }, [router])

  useEffect(() => {
    setIsSearching(true)
    const timer = setTimeout(() => {
      setIsSearching(false)
    }, 300)
    
    return () => clearTimeout(timer)
  }, [searchTerm])

  const filteredReceipts = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase().trim()
    
    return receipts.filter(receipt => {
      const fieldsToSearch = [
        receipt.id?.toString() || "",
        receipt.receiptNumber || "",
        receipt.customerName || "",
        receipt.total?.toString() || "",
        receipt.paymentStatus || ""
      ]

      const matchesSearch = fieldsToSearch.some(field => 
        field.toLowerCase().includes(lowerCaseSearchTerm)
      )
      
      const matchesStatus = 
        statusFilter === "all" || receipt.paymentStatus === statusFilter
      
      return matchesSearch && matchesStatus
    })
  }, [receipts, searchTerm, statusFilter])

  const formatCurrency = (value: number | string): string => {
    const num = typeof value === 'string' ? parseFloat(value) : value
    return isNaN(num) ? '0.00' : num.toFixed(2)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <p className="text-lg">Loading your receipts...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-6">
          <Link href="/accounts">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">Error: {error}</p>
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <Link href="/accounts">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Your Receipts</h1>
        <Link href="/create">
          <Button>Create New Receipt</Button>
        </Link>
      </div>

      {/* Enhanced Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search receipts..."
            className="pl-10 pr-4 py-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search receipts"
          />
          {isSearching && (
            <div className="absolute right-10 top-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
            </div>
          )}
          {searchTerm && !isSearching && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <p className="text-xs text-gray-500 mt-1">
            Search by receipt #, name, amount, or status
          </p>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              {statusFilter === "all" ? "All Statuses" : 
               statusFilter === "full" ? "Full payment" :
               statusFilter === "advance" ? "Advance Payment" : "Due Payment"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuRadioGroup 
              value={statusFilter} 
              onValueChange={(value) => setStatusFilter(value as any)}
            >
              <DropdownMenuRadioItem value="all">All Statuses</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="full">Full payment</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="advance">Advance payment</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="due">Due payment</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filteredReceipts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-lg text-gray-500 mb-4">
            {searchTerm || statusFilter !== "all" 
              ? "No matching receipts found" 
              : "No receipts found"}
          </p>
          <Link href="/create">
            <Button>Create Your First Receipt</Button>
          </Link>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
  <tr>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Receipt #
    </th>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Date
    </th>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Customer
    </th>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Total Amount
    </th>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Bill Type
    </th>
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      Details
    </th>
  </tr>
</thead>
<tbody className="bg-white divide-y divide-gray-200">
  {filteredReceipts.map((receipt) => (
    <tr key={receipt.id.toString()}>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {receipt.receiptNumber}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(receipt.date).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {receipt.customerName || 'N/A'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ₹{formatCurrency(receipt.total)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
            receipt.paymentStatus === "full"
              ? "bg-green-100 text-green-800"
              : receipt.paymentStatus === "advance"
              ? "bg-yellow-100 text-yellow-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {receipt.paymentStatus === "full"
            ? "full payment"
            : receipt.paymentStatus === "advance"
            ? "Advance payment"
            : "Due payment"}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <Link href={`/receipts/${receipt.id}?from=view`}>
          <Button variant="outline" size="sm">
            View Details
          </Button>
        </Link>
      </td>
    </tr>
  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
