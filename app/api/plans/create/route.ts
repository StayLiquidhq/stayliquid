import { NextRequest, NextResponse } from "next/server";
import createSupabaseServerClient from "@/lib/supabase/serverClient";

// Custom validation functions
function validateString(value: any, fieldName: string, minLength = 1, maxLength = 255): string | null {
    if (typeof value !== 'string') {
        return `${fieldName} must be a string`
    }
    const trimmed = value.trim()
    if (trimmed.length < minLength) {
        return `${fieldName} must be at least ${minLength} characters`
    }
    if (trimmed.length > maxLength) {
        return `${fieldName} must be no more than ${maxLength} characters`
    }
    return null
}

function validateNumber(value: any, fieldName: string, min = 0): string | null {
    if (typeof value !== 'number' || isNaN(value)) {
        return `${fieldName} must be a valid number`
    }
    if (value <= min) {
        return `${fieldName} must be greater than ${min}`
    }
    return null
}

function validateSchedule(value: any): string | null {
    const validSchedules = ['daily', 'weekly', 'monthly']
    if (!validSchedules.includes(value)) {
        return `Schedule must be one of: ${validSchedules.join(', ')}`
    }
    return null
}

function validateWallet(value: any): string | null {
    if (typeof value !== 'string') {
        return 'Wallet address must be a string'
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        return 'Wallet address is required'
    }
    // Basic alphanumeric validation - adjust regex based on your wallet format
    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
        return 'Wallet address contains invalid characters'
    }
    return null
}

function validateDate(value: any): string | null {
    if (typeof value !== 'string') {
        return 'Start date must be a string'
    }
    const date = new Date(value)
    if (isNaN(date.getTime())) {
        return 'Start date must be a valid date'
    }
    if (date <= new Date()) {
        return 'Start date must be in the future'
    }
    return null
}

function validateInput(body: any) {
    const errors: string[] = []
    
    // Required fields check
    const requiredFields = ['title', 'schedule', 'total_amount', 'per_payout_amount', 'wallet_to_send_to', 'start_date']
    for (const field of requiredFields) {
        if (!(field in body)) {
            errors.push(`${field} is required`)
        }
    }
    
    if (errors.length > 0) {
        return { isValid: false, errors }
    }

    // Individual field validation
    const titleError = validateString(body.title, 'Title')
    if (titleError) errors.push(titleError)

    const scheduleError = validateSchedule(body.schedule)
    if (scheduleError) errors.push(scheduleError)

    const totalAmountError = validateNumber(body.total_amount, 'Total amount')
    if (totalAmountError) errors.push(totalAmountError)

    const perPayoutError = validateNumber(body.per_payout_amount, 'Per payout amount')
    if (perPayoutError) errors.push(perPayoutError)

    const walletError = validateWallet(body.wallet_to_send_to)
    if (walletError) errors.push(walletError)

    const dateError = validateDate(body.start_date)
    if (dateError) errors.push(dateError)

    // Business logic validation
    if (typeof body.per_payout_amount === 'number' && 
        typeof body.total_amount === 'number' && 
        body.per_payout_amount > body.total_amount) {
        errors.push('Payout amount cannot exceed total amount')
    }

    return {
        isValid: errors.length === 0,
        errors,
        data: errors.length === 0 ? {
            title: body.title.trim(),
            schedule: body.schedule,
            total_amount: body.total_amount,
            per_payout_amount: body.per_payout_amount,
            wallet_to_send_to: body.wallet_to_send_to.trim(),
            start_date: body.start_date
        } : null
    }
}

export async function POST(request: NextRequest) {
    try {
        const response = NextResponse.next()


        const supabase = createSupabaseServerClient(request, response)

        // Get the currently authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            console.error('Authentication error:', authError)
            return NextResponse.json(
                { data: null, error: "Unauthorized", status: 401 },
                { status: 401 }
            )
        }

        const google_id = user.id

        // Fetch user id with google id
        const { data: fetchUserIdData, error: fetchUserIdError } = await supabase
            .from('users')
            .select('id') 
            .eq('google_id', google_id)
            .single()

        if (fetchUserIdError) {
            console.error('Error fetching user:', fetchUserIdError)
            return NextResponse.json(
                { data: null, error: "User not found", status: 404 },
                { status: 404 }
            )
        }

        const { id: user_id } = fetchUserIdData

        // Parse and validate request body
        let body
        try {
            body = await request.json()
        } catch (parseError) {
            return NextResponse.json(
                { data: null, error: "Invalid JSON in request body", status: 400 },
                { status: 400 }
            )
        }
        
        const validation = validateInput(body)
        if (!validation.isValid) {
            return NextResponse.json(
                { 
                    data: null, 
                    error: "Invalid input data", 
                    details: validation.errors,
                    status: 400 
                },
                { status: 400 }
            )
        }

        const { title, schedule, total_amount, per_payout_amount, wallet_to_send_to, start_date } = validation.data!

        // Create plan in database
        const { data: createPlanData, error: createPlanError } = await supabase
            .from("plans")
            .insert({
                user_id,
                title,
                schedule,
                total_amount,
                per_payout_amount,
                total_payouts: Math.floor(total_amount / per_payout_amount),
                wallet_to_send_to,
                start_date
            })
            .select()
            .single()

        if (createPlanError) {
            console.error('Error creating plan:', createPlanError)
            return NextResponse.json(
                { data: null, error: "Failed to create plan", status: 500 },
                { status: 500 }
            )
        }

        return NextResponse.json(
            { data: createPlanData, error: null, status: 200 },
            { status: 200 }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return NextResponse.json(
            { data: null, error: "Internal server error", status: 500 },
            { status: 500 }
        )
    }
}